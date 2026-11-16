#!/bin/bash
CONFIG_FILE="$HOME/.uploader_config.json"

clear
echo -e "\033[1;36m====================================================\033[0m"
echo -e "\033[1;32m         🤖  SETUP BOT TUMBAL SPOOFER               \033[0m"
echo -e "\033[1;36m====================================================\033[0m"
echo -e "\033[1;33mCatatan: Akun uploader (API Key & Creator ID) diatur\033[0m"
echo -e "\033[1;33mlangsung di web pada menu 'Setup Roblox'.\033[0m"
echo -e "\033[1;33mTermux HANYA butuh Cookie Bot Tumbal buat bypass aset.\033[0m"
echo -e "\033[1;36m----------------------------------------------------\033[0m"

COOKIE=""
if [ -f "$CONFIG_FILE" ]; then
    COOKIE=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE')).cookie||'')}catch(e){}")
fi

if [ -n "$COOKIE" ]; then
    echo -e "Status Bot Tumbal : \033[1;32m[✔] Cookie Aktif & Siap\033[0m"
else
    echo -e "Status Bot Tumbal : \033[1;31m[✘] Cookie Belum Diset\033[0m"
fi

echo -e "\033[1;36m----------------------------------------------------\033[0m"
echo -e "1. Set / Ganti Cookie .ROBLOSECURITY Bot Tumbal"
echo -e "2. Jalankan Server Bridge (node termux-bridge.cjs)"
echo -e "3. Keluar"
echo -e "\033[1;36m----------------------------------------------------\033[0m"
read -p "Pilih menu [1-3]: " menu

case $menu in
    1)
        echo ""
        echo -e "\033[1;33mPaste Cookie .ROBLOSECURITY bot tumbal di sini:\033[0m"
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
            echo -e "\033[1;32m✔ Cookie Bot Tumbal berhasil disimpan!\033[0m"
        else
            echo -e "\033[1;31mCookie tidak boleh kosong!\033[0m"
        fi
        ;;
    2)
        echo -e "\033[1;32mMenjalankan server bridge...\033[0m"
        node termux-bridge.cjs
        ;;
    3)
        exit 0
        ;;
    *)
        echo "Pilihan tidak valid."
        ;;
esac
