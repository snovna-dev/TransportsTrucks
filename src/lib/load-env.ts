import { config } from "dotenv";

// Next.js ya carga .env.local por su cuenta; esto cubre los scripts con `tsx`
// y la CLI de Prisma. Los valores ya definidos en el entorno no se pisan.
config({ path: [".env.local", ".env"], quiet: true });
