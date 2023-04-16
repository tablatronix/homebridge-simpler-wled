"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WLED = void 0;
const settings_1 = require("./settings");
const WebSocket = require('ws').WebSocket;
class WLED {
    /*  END LOCAL CACHING VARIABLES */
    constructor(platform, wledConfig, loadedPresets) {
        this.segments = [];
        this.ws = [];
        /*        LOGGING / DEBUGGING         */
        this.debug = false;
        this.prodLogging = false;
        this.preset = -1;
        /*  LOCAL CACHING VARIABLES */
        this.isOffline = false;
        this.on = false;
        this.brightness = -1;
        this.hue = 100;
        this.saturation = 100;
        this.colorArray = [255, 0, 0];
        this.enabledPresets = [];
        this.effectSpeed = 15;
        this.presetsAreActive = false;
        this.presets = [];
        this.lastActivePreset = 0;
        this.log = platform.log;
        this.name = wledConfig.name || 'WLED';
        this.prodLogging = wledConfig.log || false;
        this.disablePresetsSwitch = (wledConfig.presets) ? false : true;
        this.effectSpeed = wledConfig.defaultEffectSpeed || 15;
        this.showEffectControl = wledConfig.showEffectControl ? true : false;
        this.lastActivePreset = wledConfig.presets ? wledConfig.presets[0] : 0;
        this.enabledPresets = wledConfig.presets || [];
        if (wledConfig.host instanceof Array && wledConfig.host.length > 1) {
            this.host = wledConfig.host;
            this.multipleHosts = true;
        }
        else {
            this.host = [wledConfig.host];
            this.multipleHosts = false;
        }
        this.platform = platform;
        this.api = platform.api;
        this.hap = this.api.hap;
        this.Characteristic = this.api.hap.Characteristic;
        const uuid = this.api.hap.uuid.generate('homebridge:wled' + this.name);
        if ((this.wledAccessory = this.platform.accessories.find((x) => x.UUID === uuid)) === undefined) {
            this.wledAccessory = new this.api.platformAccessory(this.name, uuid);
        }
        this.log.info("Setting up Accessory " + this.name + " with Host-IP: " + this.host + ((this.multipleHosts) ? " Multiple WLED-Hosts configured" : " Single WLED-Host configured"));
        this.wledAccessory.category = 5 /* LIGHTBULB */;
        this.lightService = this.wledAccessory.addService(this.api.hap.Service.Lightbulb, this.name, 'LIGHT');
        if (this.showEffectControl) {
            this.speedService = this.wledAccessory.addService(this.api.hap.Service.Lightbulb, 'Effect Speed', 'SPEED');
            this.lightService.addLinkedService(this.speedService);
        }
        this.registerCharacteristicOnOff();
        this.registerCharacteristicBrightness();
        this.registerCharacteristicSaturation();
        this.registerCharacteristicHue();
        this.presetsService = this.wledAccessory.addService(this.api.hap.Service.Television);
        this.presetsService.setCharacteristic(this.Characteristic.ConfiguredName, "Presets");
        this.presetsService
            .getCharacteristic(this.Characteristic.Active)
            .on("get" /* GET */, (callback) => {
            callback(undefined, this.preset >= 0);
        })
            .on("set" /* SET */, (value, callback) => {
            if (value) {
                this.presetsService.setCharacteristic(this.Characteristic.ActiveIdentifier, this.lastActivePreset);
            }
            else {
                this.lastActivePreset = Number(this.presetsService.getCharacteristic(this.Characteristic.ActiveIdentifier).value);
                this.lightService.setCharacteristic(this.Characteristic.Hue, this.hue);
                this.lightService.setCharacteristic(this.Characteristic.Saturation, this.saturation);
            }
            callback();
        });
        this.addPresetsInputSources(loadedPresets);
        this.openSockets(wledConfig.host);
        this.api.publishExternalAccessories(settings_1.PLUGIN_NAME, [this.wledAccessory]);
        this.platform.accessories.push(this.wledAccessory);
        this.api.updatePlatformAccessories([this.wledAccessory]);
        this.log.info("WLED Strip finished initializing!");
    }
    registerCharacteristicOnOff() {
        this.lightService
            .getCharacteristic(this.hap.Characteristic.On)
            .on("get" /* GET */, (callback) => {
            callback(undefined, this.on);
        })
            .on("set" /* SET */, (value, callback) => {
            let tempon = value;
            if (tempon && !this.on) {
                this.turnOnWLED();
                if (this.debug)
                    this.log("Light was turned on!");
            }
            else if (!tempon && this.on) {
                this.turnOffWLED();
                if (this.debug)
                    this.log("Light was turned off!");
            }
            this.on = tempon;
            callback();
        });
    }
    registerCharacteristicBrightness() {
        this.lightService
            .getCharacteristic(this.hap.Characteristic.Brightness)
            .on("get" /* GET */, (callback) => {
            callback(undefined, this.brightness);
        })
            .on("set" /* SET */, (value, callback) => {
            this.brightness = Math.round(255 / 100 * value);
            this.httpSetBrightness();
            if (this.prodLogging)
                this.log("Set brightness to " + value + "% " + this.brightness);
            callback();
        });
    }
    registerCharacteristicHue() {
        this.lightService.getCharacteristic(this.hap.Characteristic.Hue)
            .on("get" /* GET */, (callback) => {
            let colorArray = this.HSVtoRGB(this.hue, this.saturation);
            this.colorArray = colorArray;
            // if (this.debug)
            // this.log("Current hue: " + this.hue + "%");
            callback(undefined, this.hue);
        })
            .on("set" /* SET */, (value, callback) => {
            setTimeout(() => {
                this.saturation = Number(this.lightService.getCharacteristic(this.Characteristic.Saturation).value);
                this.hue = value;
                this.lastActivePreset = Number(this.presetsService.getCharacteristic(this.Characteristic.ActiveIdentifier));
                this.turnOffAllPresets();
                let colorArray = this.HSVtoRGB(this.hue, this.saturation);
                /*
                Current bug in WLED will disable Blue when CCT is set to Warm when using "max brightness".
                This quick method will calculate the blue delta after equalizing for white overlap and
                temporarily set CCT to cooler light if any blue is detected.
                */
                let lowest = Math.min(...colorArray);
                let rawColor = colorArray.map((value) => {
                    return value - lowest;
                });
                let cct = (rawColor[2] > 0) ? `"cct": 255` : `"cct":0`;
                let segments = Array(10).fill(`{"col":[[${colorArray}]],"fx":0, ${cct}}`).join(',');
                let message = `{"seg":[
            ${segments}
          ]}`;
                this.sendMessage(message);
                this.colorArray = colorArray;
                callback();
            }, 100);
        });
    }
    registerCharacteristicSaturation() {
        this.lightService.getCharacteristic(this.hap.Characteristic.Saturation)
            .on("get" /* GET */, (callback) => {
            if (this.debug)
                this.log("Current saturation: " + this.saturation + "%");
            callback(undefined, this.saturation);
        })
            .on("set" /* SET */, (value, callback) => {
            this.saturation = value;
            this.turnOffAllPresets();
            callback();
        });
    }
    parseMessage(state) {
        this.saveColorArrayAsHSV(state.seg[0].col[0]);
        this.segments = state.seg.length;
        this.on = state.on;
        this.brightness = Math.round(100 * state.bri / 255);
        this.preset = this.enabledPresets.indexOf(state.ps);
        this.lightService.updateCharacteristic(this.hap.Characteristic.On, this.on);
        this.lightService.updateCharacteristic(this.hap.Characteristic.Brightness, this.brightness);
        this.lightService.updateCharacteristic(this.hap.Characteristic.Saturation, this.saturation);
        this.lightService.updateCharacteristic(this.hap.Characteristic.Hue, this.hue);
        if (this.preset >= 0) {
            this.presetsService
                .updateCharacteristic(this.hap.Characteristic.Active, 1)
                .updateCharacteristic(this.hap.Characteristic.ActiveIdentifier, state.ps);
        }
        else {
            this.presetsService
                .updateCharacteristic(this.hap.Characteristic.Active, 0)
                .updateCharacteristic(this.hap.Characteristic.ActiveIdentifier, this.lastActivePreset ? this.lastActivePreset : this.enabledPresets[0]);
        }
    }
    openSockets(hosts) {
        hosts = (hosts instanceof Array) ? hosts : [hosts];
        hosts.forEach((host, i) => {
            this.ws.push(new WebSocket(`ws://${host}/ws`, {
                perMessageDeflate: false
            }));
            let ws = this.ws[i];
            ws.on('message', (data) => {
                let state = JSON.parse(data).state;
                this.parseMessage(state);
            });
            ws.on('error', console.error);
            ws.on('close', () => {
                this.log('disconnected... reconnecting');
                setTimeout(() => {
                    this.openSockets(this.host);
                }, 300);
            });
            ws.on('open', () => {
                this.log('connected');
            });
        });
    }
    sendMessage(message) {
        this.ws.forEach((socket) => {
            socket.send(message);
        });
    }
    addPresetsInputSources(presets) {
        if (this.prodLogging) {
            this.log("Adding presets: " + presets);
        }
        Object.entries(presets).forEach(entry => {
            const [key, value] = entry;
            if ((this.enabledPresets.indexOf(parseInt(key))) < 0)
                return;
            let label = (value.ql ? `${value.ql} ` : '') + `${value.n} `;
            const presetInputSource = this.wledAccessory.addService(this.hap.Service.InputSource, key, label);
            presetInputSource
                .setCharacteristic(this.Characteristic.Identifier, key)
                .setCharacteristic(this.Characteristic.ConfiguredName, label)
                .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.HDMI);
            this.presetsService.addLinkedService(presetInputSource);
        });
        this.presetsService
            .getCharacteristic(this.Characteristic.ActiveIdentifier)
            .on("set" /* SET */, (newValue, callback) => {
            let id = newValue.toString();
            this.sendMessage(`{
              "ps": ${id}
            }`);
            // this.lastActivePreset = parseInt(id);
            callback(null);
        });
    }
    httpSetBrightness() {
        if (this.brightness == 0) {
            this.turnOffWLED();
            return;
        }
        let colorArray = this.HSVtoRGB(this.hue, this.saturation);
        this.colorArray = colorArray;
        if (this.debug)
            this.log("COLOR ARRAY BRIGHTNESS: " + colorArray);
        // this.host.forEach((host) => {
        //   httpSendData(`http://${host}/json`, "POST", { "bri": this.brightness }, (error: any, response: any) => { if (error) return; });
        // });
        this.sendMessage(`
    { "bri": ${this.brightness} }
    `);
    }
    turnOffWLED() {
        // this.host.forEach((host) => {
        //   httpSendData(`http://${host}/win&T=0`, "GET", {}, (error: any, response: any) => { if (error) return; });
        // });
        this.sendMessage(`{
      "on": false
    }`);
        this.on = false;
    }
    turnOnWLED() {
        // this.host.forEach((host) => {
        //   httpSendData(`http://${host}/win&T=1`, "GET", {}, (error: any, response: any) => { if (error) return; });
        // });
        this.sendMessage(`{
      "on": true
    }`);
        this.lightService.updateCharacteristic(this.hap.Characteristic.Brightness, 100);
        this.on = true;
    }
    turnOffAllPresets() {
        if (!this.disablePresetsSwitch) {
            this.presetsService.updateCharacteristic(this.Characteristic.Active, 0);
            this.lastActivePreset = Number(this.presetsService.getCharacteristic(this.Characteristic.ActiveIdentifier).value);
        }
        if (this.debug)
            this.log("Turned off Effects!");
    }
    currentBrightnessToPercent() {
        return Math.round(100 / 255 * this.brightness);
    }
    saveColorArrayAsHSV(colorArray) {
        let hsvArray = this.RGBtoHSV(colorArray[0], colorArray[1], colorArray[2]);
        this.hue = Math.floor(hsvArray[0] * 360);
        this.saturation = Math.floor(hsvArray[1] * 100);
        this.brightness = Math.floor(hsvArray[2] * 255);
    }
    colorArraysEqual(a, b) {
        if (a[0] == b[0] && a[1] == b[1] && a[2] == b[2])
            return true;
        return false;
    }
    /* accepts parameters
    * h  Object = {h:x, s:y}
    * OR
    * h, s
    */
    HSVtoRGB(h, s) {
        h = h / 360;
        s = s / 100;
        var r, g, b, i, f, p, q, t;
        if (arguments.length === 1) {
            s = h.s, h = h.h;
        }
        i = Math.floor(h * 6);
        f = h * 6 - i;
        p = (1 - s);
        q = (1 - f * s);
        t = (1 - (1 - f) * s);
        switch (i % 6) {
            case 0:
                r = 1, g = t, b = p;
                break;
            case 1:
                r = q, g = 1, b = p;
                break;
            case 2:
                r = p, g = 1, b = t;
                break;
            case 3:
                r = p, g = q, b = 1;
                break;
            case 4:
                r = t, g = p, b = 1;
                break;
            case 5:
                r = 1, g = p, b = q;
                break;
        }
        return [
            Math.round(r * 255),
            Math.round(g * 255),
            Math.round(b * 255)
        ];
    }
    /* accepts parameters
    * r  Object = {r:x, g:y, b:z}
    * OR
    * r, g, b
    */
    RGBtoHSV(r, g, b) {
        if (arguments.length === 1) {
            g = r.g, b = r.b, r = r.r;
        }
        var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h, s = (max === 0 ? 0 : d / max), v = max / 255;
        switch (max) {
            case min:
                h = 0;
                break;
            case r:
                h = (g - b) + d * (g < b ? 6 : 0);
                h /= 6 * d;
                break;
            case g:
                h = (b - r) + d * 2;
                h /= 6 * d;
                break;
            case b:
                h = (r - g) + d * 4;
                h /= 6 * d;
                break;
        }
        return [
            h,
            s,
            v
        ];
    }
}
exports.WLED = WLED;
//# sourceMappingURL=wled-accessory.js.map