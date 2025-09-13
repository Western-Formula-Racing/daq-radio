# CAN Viewer Project

This project is a CAN (Controller Area Network) viewer built using Flask and Dash. It allows users to visualize raw CAN messages, import DBC files, and filter messages based on time range and CAN ID or message name. The application features a warm, brownish color scheme to evoke a fall vibe.

## Project Structure

```
peacan
├── app.py                # Main entry point of the Flask application
├── requirements.txt      # List of dependencies for the project
├── static
│   ├── css
│   │   └── styles.css    # CSS styles for the application
│   └── js
│       └── app.js        # JavaScript code for client-side interactions
├── templates
│   └── index.html        # Main HTML template for the application
├── dbc_files
│   └── example.dbc       # Example DBC file for testing
└── README.md             # Documentation for the project
```

## Features

- **Real-time CAN Message Display**: View raw CAN messages as they are received.
- **DBC File Import**: Import DBC files to decode CAN messages and signals.
- **Filtering Options**: Filter messages by time range (past X seconds) and by CAN ID or message name.
- **User-Friendly Interface**: A clean and intuitive interface with a fall-inspired color scheme.

## Setup Instructions

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd peacan
   ```

2. **Install Dependencies**:
   Make sure you have Python installed, then run:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the Application**:
   Start the Flask server:
   ```bash
   python app.py
   ```

4. **Access the Application**:
   Open your web browser and navigate to `http://127.0.0.1:5000` to view the CAN viewer.

## Usage Guidelines

- Use the import functionality to load your DBC files.
- Enter the desired time range and CAN ID/message name to filter the displayed messages.
- The application will dynamically update the displayed data based on your filters.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.