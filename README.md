# Homebridge WLED Presets

Homebridge Plugin for WLED Strip ([WLED-Project by Aircoookie](https://github.com/Aircoookie/WLED))

### ⚙️ Installation / NPM Package
For downloading and installing the Plugin NPM is used in Homebridge: [Link to NPM Package](https://www.npmjs.com/package/homebridge-wled-presets)

## 🔨 Adding the Accessory to the config.json
To make the accessory visible in your HomeKIT App you have to add the Platform-Accessory to the config.json to the platforms section:

```
    "platforms": [
        {
            "platform": "WLED",
            "wleds": [
                {
                    "name": "LED-Tisch",
                    "host": "10.0.0.52",
                    "presets": [1,2,3],
                    "log": true
                },
                {
                    "name": "LED-Kasten",
                    "host": ["10.0.0.53", "10.0.0.54"],
                    "presets": [1,2,3],
                }
            ]
        }
    ]
```

After editing the config, restart your HomeBridge Server and add the accessory manually from the Home App.
If you encounter some issues when adding the accessory to the homekit app, open an issue in GitHub...

## 💡 Configure own Presets-Switch
To use your own presets you have an option "presets" you can add to your config.json and add as value a comma-seperated list of supported presets of your choice.

sample additional option:

```
    "platforms": [
                {
            "platform": "WLED",
            "wleds": [
                {
                    "name": "LED-Tisch",
                    "host": "10.0.0.52",
                    "presets": [1,2,3],
                    "log": false
                }
            ]
        }
    ]
```

If you want to turn off the WLED when turning off the WLED-Effect-Switch then you can add the option "turnOffWledWithEffect", (default: false)


```
    "platforms": [
                {
            "platform": "WLED",
            "wleds": [
                {
                    "name": "LED-Tisch",
                    "host": "10.0.0.52",
                    "presets": [1,2,3],
                    "turnOffWledWithEffect": true
                }
            ]
        }
    ]
```

If you want to disable the Presets-Switch to just use the normal "LightBulb" function. You can just remove the "presets" option in the config.json.

## Contributing
If you have any idea, feel free to fork it and submit your changes back to me.

## Donation
You can also support me developing this plugin by buying me a coffee and giving me motivation to keep this plugin up to date and continue developing.


