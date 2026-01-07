This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules and Skills Structure

- **Skills** (`.claude/skills/`): Manually invoked for specific integrations.

## Available Rules

| Rule                     | Applies To     | Description                                        |
| ------------------------ | -------------- | -------------------------------------------------- |
| **pnpm-usage**           | All files      | pnpm commands and troubleshooting                  |
| **git-workflow**         | All files      | Commit conventions, branch strategy, PR guidelines |
| **development-workflow** | All files      | Code style, file naming, project conventions       |
| **typescript-patterns**  | `**/*.ts`      | Type safety, exhaustiveness checks, clean code     |
| **typescript-testing**   | `**/*.test.ts` | Vitest, MSW mocking, fs-fixture                    |
| **file-operations**      | `**/*.ts`      | Native fetch API patterns and error handling       |
