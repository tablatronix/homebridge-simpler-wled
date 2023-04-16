import {
  API,
  CharacteristicEventTypes,
  Logging,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  Service,
  HAP,
} from "homebridge";
import { PLUGIN_NAME } from "./settings";
import { WLEDPlatform } from "./wled-platform";
import { httpSendData} from "./utils";
const WebSocket = require('ws').WebSocket;

interface Preset {
  id: number;
  name: string;
}

export class WLED {
  private readonly log: Logging;
  private hap: HAP;
  private api: API;
  private segments: Array<any> = [];
  private platform: WLEDPlatform;
  private ws: Array<any> = [];
  private Characteristic: any;

  private wledAccessory: PlatformAccessory;

  private name: string;
  private host: Array<string>;

  private lightService: Service;
  private speedService!: Service;
  private presetsService!: Service;

  /*        LOGGING / DEBUGGING         */
  private readonly debug: boolean = false;
  private readonly prodLogging: boolean = false;
  /*       END LOGGING / DEBUGGING      */

  private multipleHosts: boolean;
  private disablePresetsSwitch: boolean;
  private showEffectControl: boolean;
  private preset: number = -1;


  /*  LOCAL CACHING VARIABLES */

  private isOffline = false;

  private on = false;
  private brightness = -1;
  private hue = 100;
  private saturation = 100;
  private colorArray = [255, 0, 0];
  private enabledPresets: Array<number> = [];

  private effectSpeed = 15;

  private presetsAreActive = false;
  private presets: Array<number> = [];
  private lastActivePreset: number = 0;

  /*  END LOCAL CACHING VARIABLES */

  constructor(platform: WLEDPlatform, wledConfig: any, loadedPresets: Array<any>) {
    this.log = platform.log;
    this.name = wledConfig.name || 'WLED';
    this.prodLogging = wledConfig.log || false;
    this.disablePresetsSwitch = (wledConfig.presets) ? false : true;
    this.effectSpeed = wledConfig.defaultEffectSpeed || 15;
    this.showEffectControl = wledConfig.showEffectControl ? true : false;
    this.lastActivePreset = wledConfig.presets ? wledConfig.presets[0]:0;
    this.enabledPresets = wledConfig.presets || [];


    if (wledConfig.host instanceof Array && wledConfig.host.length > 1) {
      this.host = wledConfig.host;
      this.multipleHosts = true;
    } else {
      this.host = [wledConfig.host];
      this.multipleHosts = false;
    }

    this.platform = platform;
    this.api = platform.api;
    this.hap = this.api.hap;
    this.Characteristic = this.api.hap.Characteristic;
    const uuid = this.api.hap.uuid.generate('homebridge:wled' + this.name);

    if ((this.wledAccessory = this.platform.accessories.find((x: PlatformAccessory) => x.UUID === uuid)!) === undefined) {

      this.wledAccessory = new this.api.platformAccessory(this.name, uuid);

    }

    this.log.info("Setting up Accessory " + this.name + " with Host-IP: " + this.host + ((this.multipleHosts) ? " Multiple WLED-Hosts configured" : " Single WLED-Host configured"));

    this.wledAccessory.category = this.api.hap.Categories.LIGHTBULB;

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
      .on(CharacteristicEventTypes.GET, (callback: any) => {
        callback(undefined, this.preset >= 0);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if(value){
          this.presetsService.setCharacteristic(this.Characteristic.ActiveIdentifier, this.lastActivePreset);
        }else{
          this.lastActivePreset = Number(this.presetsService.getCharacteristic(this.Characteristic.ActiveIdentifier).value);
          this.lightService.setCharacteristic(this.Characteristic.Hue, this.hue);
          this.lightService.setCharacteristic(this.Characteristic.Saturation, this.saturation);
        }
        callback();
      })
    this.addPresetsInputSources(loadedPresets);
    this.openSockets(wledConfig.host);
    this.api.publishExternalAccessories(PLUGIN_NAME, [this.wledAccessory]);
    this.platform.accessories.push(this.wledAccessory);

    this.api.updatePlatformAccessories([this.wledAccessory]);
    this.log.info("WLED Strip finished initializing!");

  }

  registerCharacteristicOnOff(): void {

    this.lightService
      .getCharacteristic(this.hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        callback(undefined, this.on);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        let tempon = value as boolean;
        if (tempon && !this.on) {
          this.turnOnWLED();
          if (this.debug)
            this.log("Light was turned on!");
        } else if (!tempon && this.on) {
          this.turnOffWLED();
          if (this.debug)
            this.log("Light was turned off!");
        }
        this.on = tempon;
        callback();
      });

  }


  registerCharacteristicBrightness(): void {

    this.lightService
      .getCharacteristic(this.hap.Characteristic.Brightness)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        callback(undefined, this.brightness);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {

        this.brightness = Math.round(255 / 100 * (value as number));
        this.httpSetBrightness();

        if (this.prodLogging)
          this.log("Set brightness to " + value + "% " + this.brightness);

        callback();
      });
  }

  registerCharacteristicHue(): void {

    this.lightService.getCharacteristic(this.hap.Characteristic.Hue)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        let colorArray = this.HSVtoRGB(this.hue, this.saturation);
        this.colorArray = colorArray;
        // if (this.debug)
          // this.log("Current hue: " + this.hue + "%");

        callback(undefined, this.hue);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        setTimeout(()=> {
          this.saturation = Number(this.lightService.getCharacteristic(this.Characteristic.Saturation).value);
          this.hue = value as number;
          this.lastActivePreset = Number(this.presetsService.getCharacteristic(this.Characteristic.ActiveIdentifier));
          this.turnOffAllPresets();
          let colorArray = this.HSVtoRGB(this.hue, this.saturation);

          /*
          Current bug in WLED will disable Blue when CCT is set to Warm when using "max brightness".
          This quick method will calculate the blue delta after equalizing for white overlap and 
          temporarily set CCT to cooler light if any blue is detected.
          */

          let lowest = Math.min(...colorArray);
          let rawColor = colorArray.map((value:number)=>{
            return value - lowest;
          })
          let cct = (rawColor[2] > 0)?`"cct": 255` : `"cct":0`;
          
          let segments = Array(10).fill(`{"col":[[${colorArray}]],"fx":0, ${cct}}`).join(',');
          let message = `{"seg":[
            ${segments}
          ]}`;
          this.sendMessage(message);
          this.colorArray = colorArray;
          callback();
        },100);
      });

  }

  registerCharacteristicSaturation(): void {

    this.lightService.getCharacteristic(this.hap.Characteristic.Saturation)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        if (this.debug)
          this.log("Current saturation: " + this.saturation + "%");
        callback(undefined, this.saturation);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.saturation = value as number;
        this.turnOffAllPresets();
        callback();
      });

  }

  parseMessage(state:any): void {
    this.saveColorArrayAsHSV(state.seg[0].col[0]);
    this.segments = state.seg.length;
    this.on = state.on;
    this.brightness = Math.round(100 * state.bri/255 );
    this.preset = this.enabledPresets.indexOf(state.ps);
    this.lightService.updateCharacteristic(this.hap.Characteristic.On, this.on);
    this.lightService.updateCharacteristic(this.hap.Characteristic.Brightness, this.brightness);
    this.lightService.updateCharacteristic(this.hap.Characteristic.Saturation, this.saturation);
    this.lightService.updateCharacteristic(this.hap.Characteristic.Hue, this.hue);
    if(this.preset >= 0){
      this.presetsService
        .updateCharacteristic(this.hap.Characteristic.Active, 1)
        .updateCharacteristic(this.hap.Characteristic.ActiveIdentifier, state.ps);
    }else{
      this.presetsService
        .updateCharacteristic(this.hap.Characteristic.Active, 0)
        .updateCharacteristic(this.hap.Characteristic.ActiveIdentifier, this.lastActivePreset?this.lastActivePreset:this.enabledPresets[0]);
    }
  }

  openSockets(hosts:any): void {
    hosts = (hosts instanceof Array)? hosts: [hosts];
    hosts.forEach((host: string, i:number)=>{
      this.ws.push(new WebSocket(`ws://${host}/ws`, {
        perMessageDeflate: false
      }));
      let ws = this.ws[i];
      ws.on('message', (data:any)=> {
        let state = JSON.parse(data).state;
        this.parseMessage(state);
      });
      ws.on('error', console.error);
      ws.on('close', ()=>{
        this.log('disconnected... reconnecting');
        setTimeout(()=>{
          this.openSockets(this.host);
        },300)
      });
      ws.on('open', ()=>{
        this.log('connected');
      });
    });
    
  }

  sendMessage(message:string): void{
    this.ws.forEach((socket)=>{
      socket.send(message);
    })
  }

  addPresetsInputSources(presets: Array<any>): void {
    if (this.prodLogging) {
        this.log("Adding presets: " + presets);
    }
    Object.entries(presets).forEach(entry => {
      const [key, value] = entry;

      if((this.enabledPresets.indexOf(parseInt(key))) < 0) return;
      let label = (value.ql?`${value.ql} `:'')+`${value.n} `;
      const presetInputSource = this.wledAccessory.addService(this.hap.Service.InputSource, key, label);
      presetInputSource
          .setCharacteristic(this.Characteristic.Identifier, key)
          .setCharacteristic(this.Characteristic.ConfiguredName, label)
          .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
          .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.HDMI);
      this.presetsService.addLinkedService(presetInputSource)
    });
    this.presetsService
      .getCharacteristic(this.Characteristic.ActiveIdentifier)
      .on(CharacteristicEventTypes.SET, (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
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

  turnOffWLED(): void {
    // this.host.forEach((host) => {
    //   httpSendData(`http://${host}/win&T=0`, "GET", {}, (error: any, response: any) => { if (error) return; });
    // });
    this.sendMessage(`{
      "on": false
    }`)
    this.on = false;
  }

  turnOnWLED(): void {
    // this.host.forEach((host) => {
    //   httpSendData(`http://${host}/win&T=1`, "GET", {}, (error: any, response: any) => { if (error) return; });
    // });
    this.sendMessage(`{
      "on": true
    }`)
    this.lightService.updateCharacteristic(this.hap.Characteristic.Brightness, 100);
    this.on = true;
  }

  turnOffAllPresets(): void {
    if (!this.disablePresetsSwitch){
      this.presetsService.updateCharacteristic(this.Characteristic.Active, 0);
      this.lastActivePreset = Number(this.presetsService.getCharacteristic(this.Characteristic.ActiveIdentifier).value);
    }
    if (this.debug)
      this.log("Turned off Effects!");
  }

  currentBrightnessToPercent() {
    return Math.round(100 / 255 * this.brightness);
  }

  saveColorArrayAsHSV(colorArray: Array<number>): void {
    let hsvArray = this.RGBtoHSV(colorArray[0], colorArray[1], colorArray[2]);
    this.hue = Math.floor(hsvArray[0] * 360);
    this.saturation = Math.floor(hsvArray[1] * 100);
    this.brightness = Math.floor(hsvArray[2] * 255);
  }
  

  colorArraysEqual(a: any, b: any): boolean {
    if (a[0] == b[0] && a[1] == b[1] && a[2] == b[2])
      return true;
    return false;
  }


  /* accepts parameters
  * h  Object = {h:x, s:y}
  * OR 
  * h, s
  */
  HSVtoRGB(h: any, s: any): any {
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
      case 0: r = 1, g = t, b = p; break;
      case 1: r = q, g = 1, b = p; break;
      case 2: r = p, g = 1, b = t; break;
      case 3: r = p, g = q, b = 1; break;
      case 4: r = t, g = p, b = 1; break;
      case 5: r = 1, g = p, b = q; break;
    }
    return [
      Math.round((r as number) * 255),
      Math.round((g as number) * 255),
      Math.round((b as number) * 255)
    ];
  }

  /* accepts parameters
  * r  Object = {r:x, g:y, b:z}
  * OR 
  * r, g, b
  */
  RGBtoHSV(r: any, g: any, b: any): any {
    if (arguments.length === 1) {
      g = r.g, b = r.b, r = r.r;
    }
    var max = Math.max(r, g, b), min = Math.min(r, g, b),
      d = max - min,
      h,
      s = (max === 0 ? 0 : d / max),
      v = max / 255;

    switch (max) {
      case min: h = 0; break;
      case r: h = (g - b) + d * (g < b ? 6 : 0); h /= 6 * d; break;
      case g: h = (b - r) + d * 2; h /= 6 * d; break;
      case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }

    return [
      h,
      s,
      v
    ];
  }
}