<?php
// Chat.php
error_reporting(E_ALL & ~E_DEPRECATED);

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use React\EventLoop\LoopInterface;

class Chat implements MessageComponentInterface
{
    protected $clients;
    protected $waiting = null;      // client waiting for a partner
    protected $pairs = [];          // paired clients [clientId => partnerConn]
    protected $clientIPs = [];      // store client info: IP, userAgent, geo, connectedAt
    protected $loop;                // ReactPHP event loop

    public function __construct(LoopInterface $loop = null)
    {
        $this->clients = new \SplObjectStorage;
        $this->loop = $loop;

        echo "Chat server started.\n";

        // Minimal heartbeat every 5 minutes
        if ($this->loop) {
            $this->loop->addPeriodicTimer(300, function() {
                echo "[" . date('Y-m-d H:i:s') . "] Heartbeat: keeping server alive\n";
            });
        }
    }

    public function onOpen(ConnectionInterface $conn)
    {
        $this->clients->attach($conn);
        $ip = $conn->remoteAddress;
        echo "New connection: {$conn->resourceId}\n";

        // Pair with waiting client if available
        if ($this->waiting) {
            $this->pairs[$conn->resourceId] = $this->waiting;
            $this->pairs[$this->waiting->resourceId] = $conn;

            $conn->send("✅ You are paired with a random user!");
            $conn->send("__paired__");
            $this->waiting->send("✅ You are paired with a random user!");
            $this->waiting->send("__paired__");

            $this->waiting = null;
        } else {
            $this->waiting = $conn;
            $conn->send("⏳ Waiting for a partner...");
        }
    }

    public function onMessage(ConnectionInterface $from, $msg)
    {
        $data = json_decode($msg, true);
        if (isset($data['event']) && $data['event'] === 'init') {
            $this->clientIPs[$from->resourceId] = [
                'ip' => $data['ip'] ?? $from->remoteAddress,
                'userAgent' => $data['userAgent'] ?? null,
                'geo' => $data['geo'] ?? null,
                'connectedAt' => time(),
                'mapUrl' => isset($data['geo']['lat'], $data['geo']['lon']) ? 'https://www.google.com/maps?q=' . $data['geo']['lat'] . ',' . $data['geo']['lon'] : null
            ];
            echo "Client {$from->resourceId} initialized: ";
            print_r($this->clientIPs[$from->resourceId]);
            return;
        }

        echo "Message from {$from->resourceId}: $msg\n";

        if (!isset($this->pairs[$from->resourceId])) {
            $from->send("⛔ You are not paired yet!");
            return;
        }

        $partner = $this->pairs[$from->resourceId];

        if ($msg === '__typing__') {
            $partner->send('__typing__');
            return;
        }

        if ($msg === '__end_chat__') {
            $partner->send("__partner_ended__");
            unset($this->pairs[$partner->resourceId]);
            unset($this->pairs[$from->resourceId]);
            return;
        }

        $partner->send($msg);
    }

    public function onClose(ConnectionInterface $conn)
    {
        $this->clients->detach($conn);
        echo "Connection {$conn->resourceId} disconnected\n";

        if ($this->waiting === $conn) {
            $this->waiting = null;
        }

        if (isset($this->pairs[$conn->resourceId])) {
            $partner = $this->pairs[$conn->resourceId];
            $partner->send("⚠️ Your partner disconnected.");
            $partner->send("__partner_ended__");
            unset($this->pairs[$partner->resourceId]);
            unset($this->pairs[$conn->resourceId]);
        }
    }

    public function onError(ConnectionInterface $conn, \Exception $e)
    {
        echo "Error: {$e->getMessage()}\n";
        $conn->close();
    }
}