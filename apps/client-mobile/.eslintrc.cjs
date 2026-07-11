module.exports = {
  root: true,
  extends: ["expo"],
  ignorePatterns: ["/dist/", "/node_modules/", "*.cjs"],
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  env: { es2022: true, node: true },
};
