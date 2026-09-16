import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import {componentTagger} from "pp-tagger";

// https://vitejs.dev/config/
const hmrKeepalive = {
    name: 'hmr-ws-keepalive',
    configureServer(server: any) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const tick = () => {
            server.ws?.send({type: 'ping'});
            timer = setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
        };
        timer = setTimeout(tick, 5000 + Math.floor(Math.random() * 4000));
        server.httpServer?.on('close', () => {
            if (timer) clearTimeout(timer);
        });
    },
};

// «Гильдия» ходит в REST и WebSocket по относительным путям, чтобы в проде
// фронт, /api и /ws жили на одном домене (см. deploy/nginx.conf). В разработке
// эти пути проксируются на локальный guild-server.
const guildApi = process.env.GUILD_SERVER_URL || 'http://127.0.0.1:8000';
const guildProxy = {
    '/api': {target: guildApi, changeOrigin: true},
    '/ws': {target: guildApi, changeOrigin: true, ws: true},
};

export default defineConfig(({mode}) => ({
    plugins: [
        hmrKeepalive,
        react(),
        mode === 'development' &&
        componentTagger(),
    ].filter(Boolean),
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        allowedHosts: true,
        hmr: {
            timeout: 7000,
            overlay: false // Disables the error overlay if you only want console errors
        },
        proxy: guildProxy,
    },
    preview: {
        host: '0.0.0.0',
        port: 4173,
        allowedHosts: true,
        proxy: guildProxy,
    },
}));
