<?php
require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/Chat.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;

$server = IoServer::factory(
    new HttpServer(
        new WsServer(
            new Chat()
        )
    ),
    8080,
    '0.0.0.0' // listen on all interfaces for network access
);

echo "🚀 WebSocket server running at ws://0.0.0.0:8080\n";
$server->run();