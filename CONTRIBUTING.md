# Contributing to MCP Manager

Thank you for your interest in contributing to MCP Manager!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Start PostgreSQL: `docker compose up -d`
4. Run migrations: `pnpm db:push`
5. Start development: `pnpm dev`

## Code Style

- TypeScript strict mode
- ESLint + Prettier for formatting
- Conventional commits for commit messages

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with tests
3. Update documentation if needed
4. Submit PR with clear description

## Reporting Issues

Please include:
- Node.js and pnpm versions
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
