import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "com.example.indoornav",
	appName: "IndoorNav",
	webDir: "dist",
	server: {
		androidScheme: "https"
	}
};

export default config;
