import { BaseSuperset } from "./base-client.js";
import { SqlExecuteRequest, SqlExecuteResponse } from "../types/index.js";
import { getErrorMessage, formatSqlError, formatDatabaseError } from "../utils/error.js";

/**
 * SQL execution and database management client
 */
export class SqlClient extends BaseSuperset {

  // Get database list
  async getDatabases(): Promise<any[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.api.get('/api/v1/database/');
      let databases = response.data.result;

      // Filter databases in read-only mode
      if (this.config.readOnlyMode) {
        databases = databases.filter((db: any) => {
          const name = db.database_name || '';
          return name.startsWith('READONLY') || name.startsWith('READER');
        });
      }

      return databases;
    } catch (error) {
      throw new Error(formatDatabaseError(error, "List"));
    }
  }

  // Validate SQL query for read-only mode
  private validateReadOnlyQuery(sql: string): void {
    if (!this.config.readOnlyMode) {
      return;
    }

    // Normalize SQL for checking
    const normalizedSql = sql.trim().toUpperCase();

    // List of write operations to block
    const writeOperations = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
      'TRUNCATE', 'REPLACE', 'MERGE', 'GRANT', 'REVOKE'
    ];

    // Check if the query starts with any write operation
    for (const operation of writeOperations) {
      if (normalizedSql.startsWith(operation)) {
        throw new Error(
          `Read-only mode: ${operation} operations are not allowed.\n` +
          `Only SELECT queries are permitted in read-only mode.`
        );
      }
    }

    // Additional check for write operations anywhere in the query
    // This catches cases like "SELECT ... INTO" or multi-statement queries
    for (const operation of writeOperations) {
      const regex = new RegExp(`\\b${operation}\\b`, 'i');
      if (regex.test(sql)) {
        throw new Error(
          `Read-only mode: ${operation} operations are not allowed.\n` +
          `Only SELECT queries are permitted in read-only mode.`
        );
      }
    }
  }

  // Execute SQL query
  async executeSql(request: SqlExecuteRequest): Promise<SqlExecuteResponse> {
    try {
      // Validate query in read-only mode
      this.validateReadOnlyQuery(request.sql);

      // Build request data using correct API parameter names
      const requestData = {
        database_id: request.database_id,
        sql: request.sql,
        schema: request.schema,
        queryLimit: request.limit || 1000, // Use queryLimit instead of limit
        runAsync: false, // Use runAsync instead of async, force synchronous execution
        expand_data: request.expand_data !== false, // Default to true
        select_as_cta: false, // Disable CTA
        ctas_method: 'TABLE',
        json: true, // Add json parameter
      };

      const response = await this.makeProtectedRequest({
        method: 'POST',
        url: '/api/v1/sqllab/execute/',
        data: requestData
      });

      return response.data;
    } catch (error) {
      console.error('Execute SQL detailed error:', error);
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        console.error('Response status:', axiosError.response?.status);
        console.error('Response data:', JSON.stringify(axiosError.response?.data, null, 2));
      }

      // Use enhanced SQL error formatting
      const detailedError = formatSqlError(error, request.sql, request.database_id);
      throw new Error(detailedError);
    }
  }
} 