/**
 * @fileoverview Linter SQL — valida snippets SQL en documentación.
 */

import { Parser } from "node-sql-parser";

export interface SqlLintResult {
    valid: boolean;
    errors: string[];
}

export function lintSql(sql: string): SqlLintResult {
    const parser = new Parser();
    const errors: string[] = [];

    // node-sql-parser works best with a single statement or an array of statements
    // We'll split by ; and try to parse each. Note: this is a simple split, 
    // but usually enough for MDD SQL blocks.
    const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 5);

    for (const stmt of statements) {
        try {
            // We use 'postgresql' as the default flavor for TheForge
            parser.parse(stmt, { database: "postgresql" });
        } catch (err: any) {
            errors.push(`Error en sentencia: "${stmt.slice(0, 50)}...". Detalle: ${err.message}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function extractSqlBlocks(markdown: string): string[] {
    const regex = /```sql\s*([\s\S]*?)```/gi;
    const blocks: string[] = [];
    let match;
    while ((match = regex.exec(markdown)) !== null) {
        if (match[1]) blocks.push(match[1].trim());
    }
    return blocks;
}

export function extractJsonBlocks(markdown: string): string[] {
    const regex = /```json\s*([\s\S]*?)```/gi;
    const blocks: string[] = [];
    let match;
    while ((match = regex.exec(markdown)) !== null) {
        if (match[1]) blocks.push(match[1].trim());
    }
    return blocks;
}
