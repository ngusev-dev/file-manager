export class AppError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AppError";
  }
}

export class SecurityError extends AppError {
  constructor(message, options) {
    super(message, options);
    this.name = "SecurityError";
  }
}

const FS_MESSAGES = {
  ENOENT: "Файл или каталог не найден",
  EEXIST: "Файл или каталог уже существует",
  EISDIR: "Указан каталог, а ожидался файл",
  ENOTDIR: "Указан файл, а ожидался каталог",
  ENOTEMPTY: "Каталог не пуст",
  EACCES: "Нет доступа",
  EPERM: "Операция не разрешена",
  EBUSY: "Файл занят другим процессом",
  ELOOP: "Символические ссылки не поддерживаются",
  ECONNREFUSED: "Нет соединения с базой данных",
  "28P01": "Ошибка аутентификации в базе данных (проверьте .env)",
  "3D000": "База данных не найдена (выполните npm run db:init)",
  42883: "Хранимые функции не найдены (выполните npm run db:init)",
};

// Превращает любую ошибку в сообщение для пользователя без внутренних деталей
export function toUserMessage(err) {
  if (err instanceof AppError) return err.message;
  if (err && typeof err.code === "string" && FS_MESSAGES[err.code]) return FS_MESSAGES[err.code];
  return "Внутренняя ошибка. Операция не выполнена.";
}
