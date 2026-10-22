import path from "node:path";
import { styleText } from "node:util";
import { select, input, password } from "@inquirer/prompts";
import { config } from "./config.js";
import { toUserMessage } from "./errors.js";
import { closePool } from "./db/pool.js";
import { login, register, validateUsername, validatePassword } from "./auth/auth.js";
import { FileManager } from "./modules/fileManager.js";
import { mainMenu, runSafely } from "./cli/menu.js";

async function authenticate() {
  for (;;) {
    const action = await select({
      message: "Безопасный файловый менеджер",
      choices: [
        { name: "Вход", value: "login" },
        { name: "Регистрация", value: "register" },
        { name: "Выход", value: "exit" },
      ],
    });
    if (action === "exit") return null;

    const username = await input({
      message: "Логин",
      required: true,
      validate: validateUsername,
    });
    const pass = await password({
      message: "Пароль",
      mask: "*",
      validate: action === "register" ? validatePassword : undefined,
    });

    let user = null;
    await runSafely(async () => {
      user = action === "register" ? await register(username, pass) : await login(username, pass);
    });
    if (user) {
      if (action === "register") await runSafely(() => login(username, pass));
      console.log(styleText("green", `Добро пожаловать, ${user.username}!`));
      return user;
    }
  }
}

async function main() {
  const user = await authenticate();
  if (!user) return;
  const fm = await FileManager.open(path.join(config.sandboxDir, `user_${user.id}`), {
    maxFileSize: config.maxFileSize,
  });
  console.log(`Рабочий каталог: ${fm.root}`);
  await mainMenu({ user, fm });
}

main()
  .catch((err) => {
    if (err?.name === "ExitPromptError") return;
    console.error(styleText("red", toUserMessage(err)));
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
