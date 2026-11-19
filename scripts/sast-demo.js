import * as crypto from "node:crypto";

const key = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);

crypto.createDecipheriv("aes-128-gcm", key, iv);
