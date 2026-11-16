#!/bin/bash
CONFIG_FILE="$HOME/.uploader_config.json"

clear
echo -e "\033[1;36m====================================================\033[0m"
echo -e "\033[1;32m      🛠  SETUP BOT SPOOFER & UPLOADER TERMUX       \033[0m"
echo -e "\033[1;36m====================================================\033[0m"

# Load existing config
COOKIE=""
API_KEY=""
USER_ID=""

if [ -f "$CONFIG_FILE" ]; then
    COOKIE=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE')).cookie||'')}catch(e){}")
    API_KEY=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE')).api_key||'')}catch(e){}")
    USER_ID=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE')).user_id||'')}catch(e){}")
fi

echo -e "Status Saat Ini:"
if [ -n "$COOKIE" ]; then
    echo -e "  [✔] Cookie Bot Tumbal : \033[1;32mTerpasang\033[0m"
else
    echo -e "  [✘] Cookie Bot Tumbal : \033[1;31mBelum diset\033[0m"
fi

if [ -n "$API_KEY" ] && [ -n "$USER_ID" ]; then
    echo -e "  [✔] Uploader API Key  : \033[1;32mTerpasang (ID: $USER_ID)\033[0m"
else
    echo -e "  [✘] Uploader API Key  : \033[1;31mBelum diset\033[0m"
fi
echo -e "\033[1;36m----------------------------------------------------\033[0m"
echo -e "1. Set Cookie .ROBLOSECURITY (Akun Bot Tumbal)"
echo -e "2. Set Open Cloud API Key & User ID Uploader"
echo -e "3. Jalankan Server Bridge (node termux-bridge.cjs)"
echo -e "4. Keluar"
echo -e "\033[1;36m----------------------------------------------------\033[0m"
read -p "Pilih menu [1-4]: " menu

case $menu in
    1)
        echo ""
        echo -e "\033[1;33mMasukkan Cookie .ROBLOSECURITY bot tumbal:\033[0m"
        read -p "Cookie: " new_cookie
        new_cookie=$(echo "$new_cookie" | sed 's/^[ \t]*//;s/[ \t]*$//')
        if [ -n "$new_cookie" ]; then
            node -e "
                const fs = require('fs');
                let cfg = {};
                try { cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE')); } catch(e){}
                cfg.cookie = process.argv[1];
                fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
            " "$new_cookie"
            echo -e "\033[1;32m✔ Cookie berhasil disimpan ke $CONFIG_FILE!\033[0m"
        else
            echo -e "\033[1;31mCookie tidak boleh kosong!\033[0m"
        fi
        ;;
    2)
        echo ""
        read -p "Masukkan Roblox User ID: " new_uid
        read -p "Masukkan Open Cloud API Key: " new_key
        new_uid=$(echo "$new_uid" | sed 's/^[ \t]*//;s/[ \t]*$//')
        new_key=$(echo "$new_key" | sed 's/^[ \t]*//;s/[ \t]*$//')
        if [ -n "$new_uid" ] && [ -n "$new_key" ]; then
            node -e "
                const fs = require('fs');
                let cfg = {};
                try { cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE')); } catch(e){}
                cfg.user_id = process.argv[1];
                cfg.api_key = process.argv[2];
                fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
            " "$new_uid" "$new_key"
            echo -e "\033[1;32m✔ API Key & User ID berhasil disimpan ke $CONFIG_FILE!\033[0m"
        fi
        ;;
    3)
        echo -e "\033[1;32mMenjalankan server bridge...\033[0m"
        node termux-bridge.cjs
        ;;
    4)
        exit 0
        ;;
    *)
        echo "Pilihan tidak valid."
        ;;
esac
