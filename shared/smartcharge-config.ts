const config = {
  DATABASE_URL: "postgres://scserver:scserverpass@localhost:5432/smartcharge",
  DATABASE_SSL: "false",
  SERVER_HOST: "", // "http://localhost:3000",
  SERVER_LISTEN_IP: "0.0.0.0",
  SERVER_PORT: "3000",
  SERVER_WS: "", // "ws://localhost:3000",
  SINGLE_USER: "true",
  SINGLE_USER_PASSWORD: "password"
};

for (const key of Object.keys(config)) {
  if (process && process.env && process.env[key]) {
    (config as any)[key] = process.env[key];
  }
}

export default config;
