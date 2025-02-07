import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';

const initializeDB = async (): Promise<Database> => {
  const db = await open({
    filename: './chat.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      admin_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT,
      file_url TEXT,
      file_type TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id)
    )
  `);

  const generalRoom = await db.get('SELECT * FROM chat_rooms WHERE name = ?', ['Genel']);
  if (!generalRoom) {
    await db.run('INSERT INTO chat_rooms (name, admin_id) VALUES (?, ?)', ['Genel', 'system']);
  }

  return db;
};

export const dbHelpers = {
  async getDefaultRoom(db: Database) {
    return db.get('SELECT * FROM chat_rooms WHERE name = ?', ['Genel']);
  },
};

export default initializeDB;
