import {
    API,
    APIEvent,
    DynamicPlatformPlugin,
    Logging,
    PlatformAccessory,
    PlatformConfig,
    Service,
    Characteristic
} from "homebridge";
import { WLEDAccessory } from "./wled-accessory";
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { loadEffects, loadPresets } from "./utils";

export class WLEDPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  accessories: PlatformAccessory[] = [];
  //private readonly wleds: WLEDAccessory[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.api = api;

    this.config = config;
    this.log = log;

    if (!config) {
      return;
    }

    if (!config.wleds) {
      this.log("No WLEDAccessorys have been configured.");
      return;
    }

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.launchWLEDAccessorys.bind(this));
  }
  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }
  
  private launchWLEDAccessorys(): void {

    for (const wled of this.config.wleds) {

      if (!wled.host) {
        this.log("No host or IP address has been configured.");
        return;
      }
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate('homebridge:wled'+wled.name);
      // console.log(uuid);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
      const otherAccessories = this.accessories.filter(accessory => accessory.UUID !== uuid);

      otherAccessories.forEach( (accessory)=>{
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
      });

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);

        loadPresets(wled.host)
            .then((presets)=>{
              return presets;
            })
            .then((presets)=>{
              // console.log(presets);
              console.log('loading up existing accessory');
              new WLEDAccessory(this, existingAccessory, wled, presets);
            })
            .catch((error) => {
              console.log(error)
            });

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
        // remove platform accessories when no longer present
        
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', wled.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(wled.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.wled = wled;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        loadPresets(wled.host)
          .then((presets)=>{
            return presets;
          })
          .then((presets)=>{
            new WLEDAccessory(this, accessory, wled, presets);
            console.log('registering accessory');
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          })
          .catch((error) => {
            console.log(error)
          });

        // link the accessory to your platform
        
      }
      
  }

}
}