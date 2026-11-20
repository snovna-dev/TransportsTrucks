import "./load-env";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error("DATABASE_URL no está definida.");
    }

    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
    if (!globalForPrisma.prisma) {
        globalForPrisma.prisma = createPrismaClient();
    }
    return globalForPrisma.prisma;
}

/**
 * Cliente perezoso: se crea en el primer uso y no al importar el módulo, para
 * que `next build` no falle si DATABASE_URL todavía no está disponible.
 */
export const prisma = new Proxy({} as PrismaClient, {
    get(_target, property) {
        const client = getPrisma();
        const value = Reflect.get(client, property, client);
        return typeof value === "function" ? value.bind(client) : value;
    },
});
