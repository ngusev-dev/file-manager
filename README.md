# Безопасный файловый менеджер (SDLC, практика 1)

Консольное приложение на Node.js для работы с файлами (TXT, JSON, XML, ZIP) с хранением сведений о файлах
и журналом действий пользователей в PostgreSQL.

## Функции

| Пункт меню | Что делает | Модуль |
|---|---|---|
| Диски и файловая система | Имя, файловая система, объём, занято/свободно | `src/modules/disks.js` |
| Операции с файлами | Список, чтение, создание, перезапись, удаление | `src/modules/fileManager.js` |
| JSON / XML | Сериализация списка людей в файл и безопасное чтение с проверкой схемы | `src/modules/jsonXml.js` |
| ZIP-архивы | Создание из файлов, распаковка с лимитами | `src/modules/archive.js` |
| Мои файлы (БД) | Таблица `files` текущего пользователя | `src/audit/audit.js` |
| Журнал операций | Таблица `operations`: вход, регистрация, все действия с файлами | `src/audit/audit.js` |

## База данных

`db/schema.sql` — таблицы `users`, `files`, `operations` (тип операции — ENUM `operation_type`).
`db/procedures.sql` — хранимые функции, через которые идёт **весь** доступ к данным:
`register_user`, `get_user_auth`, `register_login_failure`, `register_login_success`,
`record_file_operation` (обновляет `files` и пишет в журнал атомарно), `get_user_files`, `get_user_operations`.
`db/roles.sql` — роль приложения `fm_app` может только вызывать эти функции, прямого доступа к таблицам у неё нет.

## Угрозы и меры защиты

| Угроза | Защита | Где | Тест |
|---|---|---|---|
| SQL-инъекция | Только параметризованные именованные prepared statements и хранимые функции; ни одной конкатенации SQL. Роль с минимальными правами | `src/db/repository.js`, `db/roles.sql` | `db.integration.test.js` |
| Path traversal | Песочница на пользователя; запрет `..` за пределы, абсолютных путей, NUL; повторная проверка после `realpath` (ссылки/junction) | `src/security/safePath.js` | `fileManager.test.js` |
| Race condition (TOCTOU) | Без пар «проверил → использовал»: создание с `O_EXCL` (`wx`), перезапись через временный файл + `rename`, размер проверяется у уже открытого дескриптора; в БД — атомарные `UPDATE` и `ON CONFLICT` | `src/modules/fileManager.js`, `db/procedures.sql` | `fileManager.test.js`, `db.integration.test.js` |
| Zip bomb | Лимиты числа записей и суммарного размера; размер считается по фактически распакованным байтам | `src/modules/archive.js` | `archive.test.js` |
| Zip Slip | Имя каждой записи проверяется `resolveInside`; ссылки в архиве запрещены; каталог назначения создаётся эксклюзивно и удаляется при ошибке | `src/modules/archive.js` | `archive.test.js` |
| XXE, billion laughs | DTD/`<!ENTITY>` запрещены целиком — без DTD остаются только 5 стандартных сущностей; парсер отказывается от имён вроде `__proto__` | `src/modules/jsonXml.js` | `jsonXml.test.js` |
| Небезопасная десериализация, prototype pollution | Только `JSON.parse`; удаление `__proto__`/`constructor`/`prototype`; строгая схема `zod` (лишние поля отклоняются); лимит размера | `src/modules/jsonXml.js` | `jsonXml.test.js` |
| Подбор пароля, утечка хешей | Argon2id (64 МБ, t=3, p=4) с уникальной солью, сравнение за постоянное время, одинаковое сообщение для неверного логина и пароля, блокировка после 5 неудач | `src/auth/` | `password.test.js`, `db.integration.test.js` |
| Исчерпание ресурсов | Лимит размера файла, таймаут SQL-запросов, ограничение выборки журнала | `src/config.js`, `src/db/pool.js` | `fileManager.test.js` |
| Утечка информации через ошибки | Пользователю — только понятное сообщение; детали — в режиме `DEBUG` | `src/errors.js` | — |

Секреты (пароли БД) хранятся только в `.env`, который исключён из git.
