// This file contains JavaScript code for the application. It handles client-side interactions, such as fetching CAN messages, applying filters based on user input, and updating the displayed data dynamically.

document.addEventListener("DOMContentLoaded", function() {
    const fetchButton = document.getElementById("fetch-button");
    const canIdInput = document.getElementById("can-id-input");
    const messageNameInput = document.getElementById("message-name-input");
    const timeRangeInput = document.getElementById("time-range-input");
    const messagesContainer = document.getElementById("messages-container");

    fetchButton.addEventListener("click", function() {
        const canId = canIdInput.value;
        const messageName = messageNameInput.value;
        const timeRange = timeRangeInput.value;

        fetch(`/api/can-messages?can_id=${canId}&message_name=${messageName}&time_range=${timeRange}`)
            .then(response => response.json())
            .then(data => {
                displayMessages(data.messages);
            })
            .catch(error => {
                console.error("Error fetching CAN messages:", error);
            });
    });

    function displayMessages(messages) {
        messagesContainer.innerHTML = ""; // Clear previous messages
        messages.forEach(message => {
            const messageDiv = document.createElement("div");
            messageDiv.className = "message";
            messageDiv.innerHTML = `
                <strong>ID:</strong> ${message.id} <br>
                <strong>Timestamp:</strong> ${new Date(message.timestamp).toLocaleString()} <br>
                <strong>Data:</strong> ${message.data} <br>
                <strong>Message Name:</strong> ${message.message_name} <br>
                <hr>
            `;
            messagesContainer.appendChild(messageDiv);
        });
    }
});