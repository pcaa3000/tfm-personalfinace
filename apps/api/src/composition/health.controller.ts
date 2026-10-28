import { Controller, Get } from "@nestjs/common";

interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

@Controller()
export class HealthController {
  @Get("health")
  getHealth(): HealthResponse {
    return {
      status: "ok",
      service: "tfm-api",
      timestamp: new Date().toISOString(),
    };
  }
}
