<?php
require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/Chat.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use React\EventLoop\Factory as LoopFactory;

// Create a ReactPHP loop
$loop = LoopFactory::create();

$server = new IoServer(
    new HttpServer(
        new WsServer(
            new Chat($loop) // pass loop to Chat for optional heartbeat
        )
    ),
    8080,
    '0.0.0.0',
    $loop
);

echo "🚀 WebSocket server running at ws://0.0.0.0:8080\n";

// Minimal heartbeat to keep server alive (runs every 5 minutes)
$loop->addPeriodicTimer(300, function() {
    echo "[" . date('Y-m-d H:i:s') . "] Heartbeat: keeping server alive\n";
});

$server->run();