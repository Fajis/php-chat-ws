<?php
// Return the client IP
// Cloudflare may set CF-Connecting-IP header
if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
    echo $_SERVER['HTTP_CF_CONNECTING_IP'];
} else {
    echo $_SERVER['REMOTE_ADDR'];
}

?>