self.addEventListener("message", event => {
	const data = event.data || { title: "New message", body: "You have a new message!" };
	self.registration.showNotification(data.title, {
		body: data.body,
		icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">👻</text></svg>',
		tag: "chat-message"
	});
});

self.addEventListener("notificationclick", event => {
	event.notification.close();
	event.waitUntil(
		clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
			if (clientList.length > 0) return clientList[0].focus();
			return clients.openWindow("/");
		})
	);
});