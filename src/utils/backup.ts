import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import { logger } from "./logger";

const execAsync = promisify(exec);

export class PostgresBackup {
  private backupDir: string;
  private sqlDir: string;
  private dbName: string;

  constructor(backupDir: string) {
    this.backupDir = backupDir;
    this.sqlDir = path.join(backupDir, "sql");
    this.createDirectories();
    this.dbName = this.extractDbName(process.env.DATABASE_URL || "");
  }

  private extractDbName(dbUrl: string): string {
    try {
      const url = new URL(dbUrl);
      // Get the database name from the pathname (remove leading slash)
      return url.pathname.slice(1) || "unknown-db";
    } catch {
      return "unknown-db";
    }
  }

  private createDirectories(): void {
    // Create both backup and sql directories
    for (const dir of [this.backupDir, this.sqlDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async createBackup(): Promise<{ sql: string; backup: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sqlFilename = `${this.dbName}-backup-${timestamp}.sql`;
    const backupFilename = `${this.dbName}-backup-${timestamp}.backup`;

    const sqlPath = path.join(this.sqlDir, sqlFilename);
    const backupPath = path.join(this.backupDir, backupFilename);

    try {
      await Promise.all([
        execAsync(`pg_dump "${process.env.DATABASE_URL}" -f ${sqlPath}`),
        execAsync(`pg_dump -Fc "${process.env.DATABASE_URL}" -f ${backupPath}`),
      ]);

      logger.info(
        `Backups created successfully for database '${this.dbName}'`,
        {
          database: this.dbName,
          sqlBackup: sqlFilename,
          customBackup: backupFilename,
          timestamp: timestamp,
        }
      );
      return { sql: sqlPath, backup: backupPath };
    } catch (error) {
      logger.error(`Backup failed for database '${this.dbName}':`, error);
      throw error;
    }
  }

  async restoreBackup(backupPath: string): Promise<void> {
    // Determine restore command based on file extension
    const command = backupPath.endsWith(".backup")
      ? `pg_restore -d "${process.env.DATABASE_URL}" --clean --if-exists ${backupPath}`
      : `psql "${process.env.DATABASE_URL}" -f ${backupPath}`;

    try {
      await execAsync(command);
      logger.info(`Restore completed successfully from: ${backupPath}`);
    } catch (error) {
      logger.error("Restore failed:", error);
      throw error;
    }
  }

  listBackups(): string[] {
    // Only list .backup files from the main backup directory
    return fs
      .readdirSync(this.backupDir)
      .filter((file) => file.endsWith(".backup"))
      .map((file) => path.join(this.backupDir, file));
  }

  listSqlDumps(): string[] {
    // Separate method to list SQL dumps
    return fs
      .readdirSync(this.sqlDir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => path.join(this.sqlDir, file));
  }
}

