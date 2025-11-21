#!/bin/bash

# AiDD MCP Authentication Mode Switcher
# Switch between browser OAuth and credential-based authentication

CONFIG_FILE="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
PROJECT_DIR="/Users/marcfridson/Documents/AiDD/claude-apple-notes-mcp"

echo "🔄 AiDD MCP Authentication Mode Switcher"
echo "=========================================="
echo ""
echo "Choose authentication mode:"
echo "1) Browser OAuth (Like GitHub/JIRA - Recommended)"
echo "2) Credential Config (Email/Password in config)"
echo "3) View current configuration"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🌐 Switching to Browser OAuth mode..."
        echo ""

        # Update the config to use OAuth browser version
        if [ -f "$CONFIG_FILE" ]; then
            # Create backup
            cp "$CONFIG_FILE" "$CONFIG_FILE.backup"

            # Update the AiDD server configuration
            /usr/bin/python3 -c "
import json
import sys

config_file = '$CONFIG_FILE'

try:
    with open(config_file, 'r') as f:
        config = json.load(f)

    # Update AiDD configuration
    if 'mcpServers' in config:
        config['mcpServers']['AiDD'] = {
            'command': 'node',
            'args': ['$PROJECT_DIR/dist/index-browser-auth.js'],
            'env': {}
        }

    # Write updated config
    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)

    print('✅ Configuration updated successfully!')
    print('')
    print('Next steps:')
    print('1. Restart Claude Desktop')
    print('2. In Claude, type: connect')
    print('3. Sign in via your browser')
    print('')
    print('This mode supports:')
    print('  • Email/Password login')
    print('  • Google SSO')
    print('  • Microsoft SSO')
    print('  • Apple SSO')

except Exception as e:
    print(f'❌ Error updating configuration: {e}')
    sys.exit(1)
"
        else
            echo "❌ Claude Desktop config file not found at: $CONFIG_FILE"
            exit 1
        fi
        ;;

    2)
        echo ""
        echo "📝 Switching to Credential Config mode..."
        echo ""
        read -p "Enter your AiDD email: " email
        read -s -p "Enter your AiDD password: " password
        echo ""

        # Update the config to use credential version
        if [ -f "$CONFIG_FILE" ]; then
            # Create backup
            cp "$CONFIG_FILE" "$CONFIG_FILE.backup"

            # Update the AiDD server configuration
            /usr/bin/python3 -c "
import json
import sys

config_file = '$CONFIG_FILE'
email = '$email'
password = '''$password'''

try:
    with open(config_file, 'r') as f:
        config = json.load(f)

    # Update AiDD configuration
    if 'mcpServers' in config:
        config['mcpServers']['AiDD'] = {
            'command': 'node',
            'args': ['$PROJECT_DIR/dist/index-aidd-auth.js'],
            'env': {
                'AIDD_EMAIL': email,
                'AIDD_PASSWORD': password,
                'AIDD_AUTH_METHOD': 'email'
            }
        }

    # Write updated config
    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)

    print('✅ Configuration updated with credentials!')
    print('')
    print('Next steps:')
    print('1. Restart Claude Desktop')
    print('2. MCP will auto-authenticate on startup')

except Exception as e:
    print(f'❌ Error updating configuration: {e}')
    sys.exit(1)
"
        else
            echo "❌ Claude Desktop config file not found at: $CONFIG_FILE"
            exit 1
        fi
        ;;

    3)
        echo ""
        echo "📋 Current AiDD MCP Configuration:"
        echo "===================================="
        if [ -f "$CONFIG_FILE" ]; then
            /usr/bin/python3 -c "
import json

config_file = '$CONFIG_FILE'

try:
    with open(config_file, 'r') as f:
        config = json.load(f)

    if 'mcpServers' in config and 'AiDD' in config['mcpServers']:
        aidd_config = config['mcpServers']['AiDD']

        # Determine mode based on the script being used
        if 'index-browser-auth.js' in str(aidd_config.get('args', [])):
            print('Mode: 🌐 Browser OAuth (Professional)')
        elif 'index-aidd-auth.js' in str(aidd_config.get('args', [])):
            if aidd_config.get('env', {}).get('AIDD_EMAIL'):
                print('Mode: 📝 Credential Config')
                print(f\"Email: {aidd_config['env']['AIDD_EMAIL']}\")
            else:
                print('Mode: 🔓 Not configured (will prompt in chat)')
        else:
            print('Mode: Unknown configuration')

        print('')
        print('Full configuration:')
        import pprint
        pprint.pprint(aidd_config, width=80)
    else:
        print('❌ AiDD MCP is not configured')

except Exception as e:
    print(f'❌ Error reading configuration: {e}')
"
        else
            echo "❌ Claude Desktop config file not found at: $CONFIG_FILE"
        fi
        ;;

    *)
        echo "Invalid choice. Please run the script again and choose 1, 2, or 3."
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "Remember to restart Claude Desktop for changes to take effect!"