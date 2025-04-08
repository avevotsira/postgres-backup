import { Command } from "commander";
import * as dotenv from "dotenv";
import cron from "node-cron";
import { PostgresBackup } from "./utils/backup";
import { logger } from "./utils/logger";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

dotenv.config();

const program = new Command();
const backup = new PostgresBackup(process.env.BACKUP_DIR || "./backups");

program.version("0.1.0").description("PostgreSQL Backup CLI");

// Move readline setup into the restore command
const createReadline = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(query, resolve);
    });
  };

  return { rl, question };
};

program
  .command("backup")
  .description("Create a new backup")
  .action(async () => {
    try {
      const paths = await backup.createBackup();
      logger.info("Backups created at:", {
        sql: paths.sql,
        backup: paths.backup,
      });
    } catch (error) {
      logger.error("Backup failed:", error);
    }
  });

program
  .command("restore")
  .description("Restore from a backup file (interactive)")
  .action(async () => {
    const { rl, question } = createReadline();

    try {
      const backups = backup.listBackups();
      if (backups.length === 0) {
        console.log("No backup files available");
        return;
      }

      displayBackups(backups);

      const answer = await question(
        `\nEnter the number of the backup to restore (1-${backups.length}), or 'q' to quit: `
      );

      if (answer.toLowerCase() === "q") {
        console.log("Restore cancelled");
        return;
      }

      const selection = Number.parseInt(answer) - 1;
      if (!isValidSelection(selection, backups.length)) {
        console.log("Invalid selection");
        return;
      }

      const selectedBackup = backups[selection];
      const confirmation = await question(
        `\nAre you sure you want to restore from ${path.basename(
          selectedBackup
        )}? (y/N): `
      );

      if (confirmation.toLowerCase() !== "y") {
        console.log("Restore cancelled");
        return;
      }

      await backup.restoreBackup(selectedBackup);
      console.log("Restore completed successfully");
    } catch (error) {
      logger.error("Restore failed:", error);
    } finally {
      rl.close();
    }
  });

function displayBackups(backups: string[]): void {
  console.log("\nAvailable backups (custom format):");
  console.log("=================================");

  backups.forEach((backup, index) => {
    const stats = fs.statSync(backup);
    const filename = path.basename(backup);
    const size = (stats.size / (1024 * 1024)).toFixed(2);
    const date = stats.mtime.toLocaleString();
    console.log(`\n${index + 1}) ${filename}`);
    console.log(`   Size: ${size} MB`);
    console.log(`   Date: ${date}`);
  });
}

function isValidSelection(selection: number, maxLength: number): boolean {
  return !Number.isNaN(selection) && selection >= 0 && selection < maxLength;
}

program
  .command("list")
  .description("List all backups")
  .option("-s, --sql", "List SQL dumps instead of backup files")
  .action((options: { sql?: boolean }) => {
    const files = options.sql ? backup.listSqlDumps() : backup.listBackups();
    if (files.length === 0) {
      console.log(
        options.sql ? "No SQL dumps available" : "No backups available"
      );
      return;
    }

    console.log(`\nAvailable ${options.sql ? "SQL dumps" : "backups"}:`);
    console.log("==================");
    for (const file of files) {
      const stats = fs.statSync(file);
      const filename = path.basename(file);
      const size = (stats.size / (1024 * 1024)).toFixed(2);
      const date = stats.mtime.toLocaleString();
      console.log(`\nFile: ${filename}`);
      console.log(`Size: ${size} MB`);
      console.log(`Date: ${date}`);
    }
  });

program
  .command("schedule")
  .description("Schedule daily backups")
  .action(() => {
    // Run backup every day at 00:00
    cron.schedule("0 0 * * *", async () => {
      try {
        await backup.createBackup();
        logger.info("Scheduled backup completed");
      } catch (error) {
        logger.error("Scheduled backup failed:", error);
      }
    });
    logger.info("Daily backups scheduled");
  });

program.parse(process.argv);

