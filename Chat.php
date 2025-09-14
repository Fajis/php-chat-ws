<?php
// Chat.php
error_reporting(E_ALL & ~E_DEPRECATED);

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;

class Chat implements MessageComponentInterface {
    protected $clients;
    protected $waiting = null;      // client waiting for a partner
    protected $pairs = [];          // paired clients [clientId => partnerConn]

    public function __construct() {
        $this->clients = new \SplObjectStorage;
        echo "Chat server started.\n";
    }

    public function onOpen(ConnectionInterface $conn) {
        $this->clients->attach($conn);
        echo "New connection: {$conn->resourceId}\n";

        // Pair with waiting client if available
        if ($this->waiting) {
            $this->pairs[$conn->resourceId] = $this->waiting;
            $this->pairs[$this->waiting->resourceId] = $conn;

            $conn->send("✅ You are paired with a random user!");
            $conn->send("__paired__"); // signal client that partner is online
            $this->waiting->send("✅ You are paired with a random user!");
            $this->waiting->send("__paired__"); // signal waiting client that partner is online

            $this->waiting = null;
        } else {
            $this->waiting = $conn;
            $conn->send("⏳ Waiting for a partner...");
        }
    }

    public function onMessage(ConnectionInterface $from, $msg) {
        echo "Message from {$from->resourceId}: $msg\n";

        if (!isset($this->pairs[$from->resourceId])) {
            $from->send("⛔ You are not paired yet!");
            return;
        }

        $partner = $this->pairs[$from->resourceId];

        // Handle typing status separately
        if ($msg === '__typing__') {
            $partner->send('__typing__');
            return;
        }

        // Handle end chat
        if ($msg === '__end_chat__') {
            $partner->send("__partner_ended__"); // notify the partner
            unset($this->pairs[$partner->resourceId]);
            unset($this->pairs[$from->resourceId]);
            return;
        }


        $partner->send($msg); // forward only to partner
    }

    public function onClose(ConnectionInterface $conn) {
        $this->clients->detach($conn);
        echo "Connection {$conn->resourceId} disconnected\n";

        // Remove from waiting
        if ($this->waiting === $conn) {
            $this->waiting = null;
        }

        // Notify and remove pair
        if (isset($this->pairs[$conn->resourceId])) {
            $partner = $this->pairs[$conn->resourceId];
            $partner->send("⚠️ Your partner disconnected.");
            $partner->send("__partner_ended__");
            unset($this->pairs[$partner->resourceId]);
            unset($this->pairs[$conn->resourceId]);
        }
    }

    public function onError(ConnectionInterface $conn, \Exception $e) {
        echo "Error: {$e->getMessage()}\n";
        $conn->close();
    }
}