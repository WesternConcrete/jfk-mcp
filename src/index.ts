#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArchivesApiClient } from "archives-api-client";
import fetch from 'node-fetch';
import dotenv from "dotenv";

dotenv.config();

// @ts-ignore
globalThis.fetch = fetch;

const API_KEY = process.env.ARCHIVES_API_KEY;
if (!API_KEY) {
  throw new Error("ARCHIVES_API_KEY environment variable is required");
}

// ------------------------------
// COMMON FILTER TYPES
// ------------------------------

const TextFilterSchema = z.union([
  z.object({
    operator: z.literal("contains"),
    value: z.string().describe("Substring to search within text fields"),
  }),
  z.object({
    operator: z.literal("isNull"),
  }),
]).describe("Filter for text fields (contains or isNull)");

const KeywordFilterSchema = z.union([
  z.object({
    operator: z.literal("eq"),
    value: z.string().describe("Exact match for a keyword"),
  }),
  z.object({
    operator: z.literal("isNull"),
  }),
]).describe("Filter for keyword fields (equality or isNull)");

const DateFilterSchema = z.union([
  z.object({
    operator: z.union([
      z.literal("gte"),
      z.literal("lte"),
      z.literal("gt"),
      z.literal("lt"),
      z.literal("eq"),
    ]),
    value: z.string().date().describe("A date value for comparison").transform((val) => new Date(val)),
  }),
  z.object({
    operator: z.literal("between"),
    value: z.tuple([
      z.string().date().transform((val) => new Date(val)),
      z.string().date().transform((val) => new Date(val)),
    ]).describe("Tuple with start and end date"),
  }),
  z.object({
    operator: z.literal("isNull"),
  }),
]).describe("Filter for date fields (with various operators)");

const NumberFilterSchema = z.union([
  z.object({
    operator: z.literal("eq"),
    value: z.number().describe("Must equal the provided number"),
  }),
  z.object({
    operator: z.literal("gt"),
    value: z.number().describe("Must be greater than the provided number"),
  }),
  z.object({
    operator: z.literal("lt"),
    value: z.number().describe("Must be less than the provided number"),
  }),
  z.object({
    operator: z.literal("gte"),
    value: z.number().describe("Must be greater than or equal to the provided number"),
  }),
  z.object({
    operator: z.literal("lte"),
    value: z.number().describe("Must be less than or equal to the provided number"),
  }),
  z.object({
    operator: z.literal("between"),
    value: z.tuple([z.number(), z.number()]).describe("Tuple defining lower and upper bounds"),
  }),
]).describe("Filter for numeric fields");

// ------------------------------
// BASE METADATA FILTER
// ------------------------------

const BaseMetadataFilterSchema = z.object({
  link: KeywordFilterSchema.optional().describe("Filter by link using keyword equality or null check"),
  link_id: KeywordFilterSchema.optional().describe("Filter by link_id using keyword equality or null check"),
  page_id: KeywordFilterSchema.optional().describe("Filter by page_id using keyword equality or null check"),
}).describe("Base metadata filters shared by all document types");

// ------------------------------
// SPECIFIC METADATA FILTERS: JFKMetadataFilter
// ------------------------------

const JFKMetadataFilterSchema = BaseMetadataFilterSchema.extend({
  comments: TextFilterSchema.optional().describe("Filter on comments using text operators"),
  document_date: DateFilterSchema.optional().describe("Filter by document date"),
  document_type: KeywordFilterSchema.optional().describe("Filter by document type"),
  file_name: KeywordFilterSchema.optional().describe("Filter by file name"),
  file_number: KeywordFilterSchema.optional().describe("Filter by file number"),
  formerly_withheld: KeywordFilterSchema.optional().describe("Filter by formerly withheld status"),
  from_name: KeywordFilterSchema.optional().describe("Filter by originating name"),
  nara_release_date: DateFilterSchema.optional().describe("Filter by NARA release date"),
  originator: KeywordFilterSchema.optional().describe("Filter by originator"),
  pages_released: NumberFilterSchema.optional().describe("Filter by number of pages released"),
  page_count: NumberFilterSchema.optional().describe("Filter by total page count"),
  record_number: KeywordFilterSchema.optional().describe("Filter by record number"),
  review_date: DateFilterSchema.optional().describe("Filter by review date"),
  to_name: KeywordFilterSchema.optional().describe("Filter by destination name"),
}).describe("Metadata filters specific to JFK documents");

// For vector search, filtering by comments is not supported.
const VectorMetadataFilterSchema = JFKMetadataFilterSchema.omit({ comments: true });

// ------------------------------
// SEARCH INPUT TYPES
// ------------------------------

const TextSearchInputSchema = {
  query: z.string().describe("The text query to search for. Good for keyword search. Matches for exact query string."),
  metadata: JFKMetadataFilterSchema.optional().describe("Optional metadata filters for text search"),
  limit: z.number().min(1).max(100).optional().describe("Max results to return (default: 25)"),
}

const VectorSearchInputSchema = {
  query: z.string().describe("The text query to use for vector search. Good for semantic search."),
  metadata: VectorMetadataFilterSchema.optional().describe("Optional metadata filters (excluding comments) for vector search"),
  limit: z.number().min(1).max(100).optional().describe("Max results to return (default: 25)"),
}

const MetadataSearchInputSchema = {
  metadata: JFKMetadataFilterSchema.describe("Metadata filters for the search"),
  limit: z.number().min(1).max(100).optional().describe("Max results to return (default: 25)"),
}

// ------------------------------
// PAGE INPUT SCHEMA
// ------------------------------

const PageInputSchema = {
  page_ids: z.array(z.string()).describe("List of page IDs to retrieve"),
}

// ----------------------------------------------------------------------------
// MCP Server Setup for JFK Files
// ----------------------------------------------------------------------------

// Create the MCP server instance for JFK files.
const server = new McpServer({
  name: "jfk",
  version: "1.0.0",
});

// Instantiate the Archives API Client for the "jfk" file group.
const archivesApiClient = new ArchivesApiClient({
  apiKey: API_KEY,
});

// ----------------------------------------------------------------------------
// Register MCP Tools (Endpoints)
// ----------------------------------------------------------------------------

// Text Search Endpoint
server.tool(
  "jfk-text-search",
  "Perform a text search on JFK files using a query string and optional metadata filters. Should only use 1 word for the query, since it does an exact match. NARA release dates between 2017-2025",
  TextSearchInputSchema,
  async (input) => {
    const { query, metadata, limit } = input;
    try {
      const result = await archivesApiClient.jfk.search.text({ query, metadata, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error performing text search: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Vector Search Endpoint
server.tool(
  "jfk-vector-search",
  "Perform a vector search on JFK files using a query string and optional metadata filters (excluding comments). NARA release dates between 2017-2025",
  VectorSearchInputSchema,
  async (input) => {
    const { query, metadata, limit } = input;
    try {
      const result = await archivesApiClient.jfk.search.vector({ query, metadata, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error performing vector search: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Metadata Search Endpoint
server.tool(
  "jfk-metadata-search",
  "Perform a metadata search on JFK files using detailed metadata filters. NARA release dates between 2017-2025",
  MetadataSearchInputSchema,
  async (input) => {
    const { metadata, limit } = input;
    try {
      const result = await archivesApiClient.jfk.search.metadata({ metadata, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error performing metadata search: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Get Page Text Endpoint
server.tool(
  "jfk-get-page-text",
  "Retrieve text content for specific pages of a JFK document",
  PageInputSchema,
  async (input) => {
    const { page_ids } = input;
    try {
      const result = await archivesApiClient.jfk.pages.getText({ page_ids });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving page text: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Get Page PNGs Endpoint
server.tool(
  "jfk-get-page-png",
  "Retrieve PNG images for specific pages of a JFK document",
  PageInputSchema,
  async (input) => {
    const { page_ids } = input;
    try {
      const result = await archivesApiClient.jfk.pages.getPng({ page_ids });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving page PNGs: ${error.message}`,
          },
        ],
      };
    }
  }
);

// ----------------------------------------------------------------------------
// Main function to start the MCP server using standard I/O transport.
// ----------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("JFK MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
