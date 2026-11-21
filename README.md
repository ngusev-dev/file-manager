# Безопасный файловый менеджер (SDLC, практика 1)

Консольное приложение на Node.js для работы с файлами (TXT, JSON, XML, ZIP) с хранением сведений о файлах
и журналом действий пользователей в PostgreSQL.

## Функции

| Пункт меню | Что делает | Модуль |
|---|---|---|
| Диски и файловая система | Имя, файловая система, объём, занято/свободно | `src/modules/disks.js` |
| Операции с файлами | Список, чтение, создание, перезапись, удаление | `src/modules/fileManager.js` |
| JSON | Создание, чтение и перезапись JSON произвольной структуры | `src/modules/jsonXml.js` |
| XML | Создание, чтение и перезапись XML произвольной структуры | `src/modules/jsonXml.js` |
| ZIP-архивы | Создание из файлов, распаковка с лимитами | `src/modules/archive.js` |
| Мои файлы (БД) | Таблица `files` текущего пользователя | `src/audit/audit.js` |
| Журнал операций | Таблица `operations`: вход, регистрация, все действия с файлами | `src/audit/audit.js` |

В меню JSON можно ввести объект, массив, строку, число, `true`, `false` или `null`.
Например: `{"project":"files","settings":{"enabled":true},"items":[1,"text",null]}`.
Данные сохраняются и выводятся с отступами; перед перезаписью запрашивается подтверждение.
Действуют лимит размера файла и удаление ключей `__proto__`, `constructor`, `prototype` на всех уровнях.
В меню XML можно ввести документ с любым корневым элементом, вложенными элементами и атрибутами.
Например: `<project name="files"><settings><enabled>true</enabled></settings><items><item>text</item></items></project>`.
Сохраняются порядок элементов, текст, комментарии и CDATA; перед перезаписью запрашивается подтверждение.
Действуют лимит размера файла, проверка корректности XML и запрет DTD/объявлений сущностей.

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
| Небезопасная десериализация, prototype pollution | Только `JSON.parse`; удаление `__proto__`/`constructor`/`prototype` в JSON; проверка имён XML-элементов парсером; лимит размера | `src/modules/jsonXml.js` | `jsonXml.test.js` |
| Подбор пароля, утечка хешей | Argon2id (64 МБ, t=3, p=4) с уникальной солью, сравнение за постоянное время, одинаковое сообщение для неверного логина и пароля, блокировка после 5 неудач | `src/auth/` | `password.test.js`, `db.integration.test.js` |
| Исчерпание ресурсов | Лимит размера файла, таймаут SQL-запросов, ограничение выборки журнала | `src/config.js`, `src/db/pool.js` | `fileManager.test.js` |
| Утечка информации через ошибки | Пользователю — только понятное сообщение; детали — в режиме `DEBUG` | `src/errors.js` | — |

При локальной разработке задайте пароли БД в `.env`, который исключён из git.

## CI/CD (SDLC, практика 2)

[Условия практики](https://sdlc.yonote.ru/share/SDLC_Lab_2) реализованы в
[`.github/workflows/main.yml`](.github/workflows/main.yml). GitHub Actions запускает конвейер
при push и pull request в `main`, а также вручную из вкладки **Actions**.
Локально тот же конвейер запускается через [act](https://nektosact.com/installation/).

| Стадия | Что выполняется |
| --- | --- |
| Build | BuildKit устанавливает зависимости через `npm ci` по `package-lock.json` и проверяет синтаксис JavaScript через `node --check`. Образ приложения передаётся в Test и Local Deploy через артефакт `file-manager-image`. |
| Test | Compose дожидается инициализации PostgreSQL. Модульные и интеграционные тесты выполняются в контейнере собранного образа. Ошибка подключения к БД останавливает стадию. Артефакт `junit` содержит отчёт JUnit XML. |
| SAST | Semgrep проверяет исходники приложения и скрипты. Уровни High, Critical и устаревший уровень Error блокируют развёртывание. Артефакт `semgrep` содержит JSON-отчёт. |
| Local Deploy | Docker Compose запускает проверенный образ с PostgreSQL и ждёт ответа `GET /health`. Приложение работает под пользователем `node`. |

Если любая из четырёх стадий завершается с ошибкой, финальная задача Cleanup удаляет
артефакт `file-manager-image` текущего запуска как в GitHub Actions, так и в локальном `act` 0.2.98. Отчёты `junit` и `semgrep`
сохраняются для диагностики. При успешном прохождении всех стадий образ остаётся в артефактах.

Dockerfile кэширует пакеты в npm-кэше BuildKit. Между запусками
`actions/cache` сохраняет слои BuildKit, включая слой с установленными зависимостями.
Для тестов и демонстрационного развёртывания workflow генерирует временные пароли БД
и передаёт их в контейнеры через переменные окружения.

### Локальный запуск

Запустите Docker Desktop в режиме Linux-контейнеров и установите `act`.
Из корня репозитория выполните:

```sh
act workflow_dispatch -W .github/workflows/main.yml --artifact-server-path .artifacts/act --env APP_PORT=0
```

Артефакты сохраняются в `.artifacts/act/`. Параметр `APP_PORT=0` позволяет Docker выбрать
свободный порт на компьютере. Local Deploy дожидается статуса `healthy`, выводит назначенный
порт и удаляет контейнеры и тома своего запуска.

Для демонстрации на защите откройте журнал четырёх стадий, JUnit-отчёт и отчёт Semgrep.
Архив финального образа можно загрузить из артефактов и импортировать через `docker load -i file-manager-image.tar.gz`.
