#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const parseModelName = (model) => {
    return model.name
        .split("::")
        .pop()
        .split("_")
        .map((part) => {
            // Check if the part is a number
            if (!isNaN(parseInt(part))) {
                return part; // Keep numbers as is
            }
            // Convert part to uppercase if it's a known acronym or before a number
            if (part.length <= 3 || !isNaN(parseInt(part.charAt(0)))) {
                return part.toUpperCase();
            }
            // Otherwise, capitalize the first letter and make the rest lowercase
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("");
};

// Check for the required arguments
if (process.argv.length !== 6) {
    console.log(
        "Usage: <MANIFEST_PATH> <OUTPUT_PATH> <RPC_URL> <WORLD_ADDRESS>"
    );
    process.exit(1);
}

// Extract paths from command-line arguments
const manifestPath = path.resolve(process.argv[2]);
const jsFilePath = path.resolve(process.argv[3]);
const rpcUrl = process.argv[4];
const worldAddress = process.argv[5];

// check that `sozo` command exist
try {
    execSync(`command -v sozo 2>/dev/null`);
} catch (e) {
    console.error(
        "unable to find `sozo` command. Please install using `dojoup`."
    );
    process.exit(0);
}

const cairoToRecsType = {
    bool: "RecsType.Boolean",
    u8: "RecsType.Number",
    u16: "RecsType.Number",
    u32: "RecsType.Number",
    u64: "RecsType.Number",
    usize: "RecsType.Number",
    u128: "RecsType.BigInt",
    u256: "RecsType.BigInt",
    felt252: "RecsType.BigInt",
    contractaddress: "RecsType.BigInt",
};

const manifestStr = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestStr);

let fileContent = `/* Autogenerated file. Do not edit manually. */\n\n`;
fileContent += `import { defineComponent, Type as RecsType, World } from "@dojoengine/recs";\n\n`;
fileContent += `export function defineContractComponents(world: World) {\n  return {\n`;

manifest.models.forEach((model) => {
    const types = [];
    const customTypes = [];

    let modelName = parseModelName(model);

    try {
        const output = execSync(
            `sozo model schema ${modelName} --rpc-url ${rpcUrl} --json --world ${worldAddress}`
        ).toString();

        const schema = JSON.parse(output);
        const recsTypeObject = parseModelSchemaToRecs(
            schema,
            types,
            customTypes
        );

        fileContent += `	  ${modelName}: (() => {\n`;
        fileContent += `	    return defineComponent(\n`;
        fileContent += `	      world,\n`;
        fileContent += `	      ${recsTypeObject},\n`;
        fileContent += `	      {\n`;
        fileContent += `	        metadata: {\n`;
        fileContent += `	          name: "${modelName}",\n`;
        fileContent += `	          types: ${JSON.stringify(types)},\n`;
        fileContent += `	          customTypes: ${JSON.stringify(
            customTypes
        )},\n`;
        fileContent += `	        },\n`;
        fileContent += `	      }\n`;
        fileContent += `	    );\n`;
        fileContent += `	  })(),\n`;
    } catch (e) {
        console.error(
            `error when fetching schema for model '${modelName}' from ${rpcUrl}: ${e}`
        );
        process.exit(0);
    }
});

fileContent += `  };\n}\n`;

fs.writeFile(jsFilePath, fileContent, (err) => {
    if (err) {
        console.error("error writing file:", err);
    } else {
        console.log("Components file generated successfully:", jsFilePath);
    }
});

function parseModelSchemaToRecs(schema, types, customTypes) {
    // top level type must be struct
    if (schema.type !== "struct") {
        throw new Error("unsupported root schema type");
    }
    return parseSchemaStruct(schema.content, types, customTypes);
}

function parseModelSchemaToRecsImpl(schema, types, customTypes) {
    const type = schema.type;
    const content = schema.content;

    if (type === "primitive") {
        return parseSchemaPrimitive(content, types);
    } else if (type === "struct") {
        customTypes.push(content.name);
        return parseSchemaStruct(content, types, customTypes);
    } else if (type === "enum") {
        types.push("enum");
        customTypes.push(content.name);
        return parseSchemaEnum(content);
    } else if (type === "tuple") {
        return parseSchemaTuple(content, types, customTypes);
    }
}

function parseSchemaPrimitive(content, types) {
    const scalarType = content["scalar_type"].toLowerCase();
    types.push(scalarType);
    return cairoToRecsType[scalarType] ?? "RecsType.String"; // Default type set to String
}

function parseSchemaStruct(content, types, customTypes) {
    return `{ ${content.children
        .map((member) => {
            return `${member.name}: ${parseModelSchemaToRecsImpl(
                member.member_type,
                types,
                customTypes
            )}`;
        })
        .join(", ")} }`;
}

function parseSchemaEnum(_schema) {
    return "RecsType.Number";
}

function parseSchemaTuple(content, types, customTypes) {
    return `[ ${content
        .map((schema) => parseModelSchemaToRecsImpl(schema, types, customTypes))
        .join(", ")} ]`;
}
