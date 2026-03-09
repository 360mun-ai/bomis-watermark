import os from 'os';

export const dynamic = 'force-dynamic';

export async function GET() {
    const cpus = os.cpus();
    const logicalCores = cpus.length;
    const totalMemoryGB = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    const recommended = Math.max(2, Math.floor(logicalCores * 0.8));
    const cpuModel = cpus[0]?.model?.trim() || 'Unknown';
    const platform = `${os.platform()} ${os.arch()}`;

    return Response.json({
        logicalCores,
        totalMemoryGB,
        recommended,
        cpuModel,
        platform,
    });
}
