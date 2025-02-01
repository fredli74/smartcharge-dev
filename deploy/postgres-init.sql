-- Create the server user
CREATE USER scserver WITH LOGIN PASSWORD 'scserver';
COMMENT ON ROLE scserver IS 'smartcharge.dev server user';

-- Create the server database
CREATE DATABASE smartcharge WITH OWNER scserver
  ENCODING UTF8 LC_COLLATE 'en_US.utf-8' LC_CTYPE 'en_US.utf-8' TEMPLATE template0;

-- Set default schema
ALTER ROLE scserver IN DATABASE smartcharge SET search_path TO scserver;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE smartcharge TO scserver;