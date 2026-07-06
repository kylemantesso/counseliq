import { createInterface } from "readline";

export function createPrompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (prompt) =>
    new Promise((resolve) => rl.question(prompt, resolve));

  async function promptToken(label, { envVar, helpText, required = true } = {}) {
    const fromEnv = envVar ? process.env[envVar]?.trim() : "";
    if (fromEnv) {
      console.log(`  ✓ ${label} (from ${envVar})`);
      return fromEnv;
    }

    console.log("");
    if (helpText) {
      for (const line of helpText) {
        console.log(`  ${line}`);
      }
      console.log("");
    }

    const suffix = required ? "" : " (Enter to skip)";
    const value = await question(`${label}${suffix}: `);
    const trimmed = value.trim();
    if (required && !trimmed) {
      throw new Error(`${label} is required.`);
    }
    return trimmed || null;
  }

  async function promptYesNo(message, defaultYes = true) {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = await question(`${message} ${suffix}: `);
    if (!answer.trim()) return defaultYes;
    return /^y/i.test(answer);
  }

  async function promptChoice(message, choices, defaultIndex = 0) {
    console.log(`\n${message}`);
    choices.forEach((choice, index) => {
      const marker = index === defaultIndex ? "*" : " ";
      console.log(`  ${marker} ${index + 1}. ${choice.label}`);
    });
    const answer = await question(
      `Choose [1-${choices.length}] (default ${defaultIndex + 1}): `
    );
    if (!answer.trim()) return choices[defaultIndex].value;
    const picked = Number.parseInt(answer, 10);
    if (Number.isNaN(picked) || picked < 1 || picked > choices.length) {
      return choices[defaultIndex].value;
    }
    return choices[picked - 1].value;
  }

  function close() {
    rl.close();
  }

  return { question, promptToken, promptYesNo, promptChoice, close };
}
