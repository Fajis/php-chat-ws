<?php
require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/Chat.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use React\EventLoop\Factory as LoopFactory;
use React\Socket\Server as ReactSocketServer;

// Create a ReactPHP loop
$loop = LoopFactory::create();

// Create React socket server on 0.0.0.0:8080
$socket = new ReactSocketServer('0.0.0.0:8080', $loop);

// Create Ratchet server with the socket
$server = new IoServer(
    new HttpServer(
        new WsServer(
            new Chat($loop) // pass loop to Chat for optional heartbeat
        )
    ),
    $socket,
    $loop
);

echo "🚀 WebSocket server running at ws://0.0.0.0:8080\n";

// Minimal heartbeat to keep server alive (runs every 5 minutes)
$loop->addPeriodicTimer(300, function() {
    echo "[" . date('Y-m-d H:i:s') . "] Heartbeat: keeping server alive\n";
});

$server->run();