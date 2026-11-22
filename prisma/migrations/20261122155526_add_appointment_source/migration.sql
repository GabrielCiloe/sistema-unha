-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('PUBLIC', 'ADMIN');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "source" "AppointmentSource" NOT NULL DEFAULT 'PUBLIC';
