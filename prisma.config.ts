import "dotenv/config"
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "postgresql://postgres:xikmid-qyjgy1-tavmaQ@db.medyvfhznlpimxbwfymk.supabase.co:5432/postgres?sslmode=require",
  },
})
