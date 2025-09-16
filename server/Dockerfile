# Use PHP CLI image
FROM php:8.2-cli

# Install required extensions for Ratchet
RUN apt-get update && apt-get install -y \
    git unzip libicu-dev libzip-dev && \
    docker-php-ext-install intl pcntl sockets

# Set working directory
WORKDIR /app

# Copy project files
COPY . /app

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Expose the port your WebSocket server listens on
EXPOSE 8080

# Start the Ratchet WebSocket server
CMD ["php", "server.php"]