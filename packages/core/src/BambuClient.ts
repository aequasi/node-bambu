import * as mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import * as events from 'eventemitter3';
import * as ftp from 'basic-ftp';

import { isPrintMessage, isPushStatusCommand } from './interfaces/MQTTPacketResponse/print';
import type { GetVersionCommand as GetVersionCommandInterface } from './interfaces/MQTTPacketResponse/info';
import { isGetVersionCommand, isInfoMessage } from './interfaces/MQTTPacketResponse/info';
import { getCleanPushInfoCommand, isMCPrintMessage, isPushInfoCommand } from './interfaces/MQTTPacketResponse/mc_print';
import { PrinterStatus } from './util/PrinterStatus';
import type { BambuClientEvents, Device, Logger } from './interfaces';
import { ConsoleLogger } from './util/ConsoleLogger';
import { FtpService } from './Service/FtpService';
import type { CommandInterface } from './Commands';
import { GetVersionCommand, PushAllCommand } from './Commands';

export interface BambuConfig {
  debugFtp?: boolean;
  host: string;
  logger?: Logger;
  port?: number;
  serial: string;
  token: string;
}

export class BambuClient extends events.EventEmitter<keyof BambuClientEvents> {
  public get connected() {
    return this.mqttClient?.connected ?? false;
  }

  public get device(): Device | undefined {
    return this._device;
  }

  public readonly ftp: ftp.Client = new ftp.Client(2 * 60 * 1000);
  public readonly printerStatus: PrinterStatus;
  protected mqttClient: mqtt.MqttClient | undefined;
  protected logger: Logger;
  protected ftpService: FtpService;

  private _device: Device | undefined;

  public constructor(public readonly config: BambuConfig) {
    super();

    this.logger = config.logger ?? new ConsoleLogger({ label: 'Bambu' });
    this.printerStatus = new PrinterStatus(this);
    this.ftpService = new FtpService(this, this.ftp, this.printerStatus, this.logger, this.config);
  }

  public override emit<K extends keyof BambuClientEvents>(event: K, ...arguments_: BambuClientEvents[K]): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public override emit(event: string, ...arguments_: any[]): boolean {
    return super.emit(event as keyof BambuClientEvents, ...arguments_);
  }

  public override off<K extends keyof BambuClientEvents>(
    event: K,
    listener?: (...arguments_: BambuClientEvents[K]) => void,
  ): this;
  public override off(
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener?: (...arguments_: any[]) => void,
  ): this {
    super.off(event as keyof BambuClientEvents, listener);

    return this;
  }

  public override once<K extends keyof BambuClientEvents>(
    event: K,
    listener: (...arguments_: BambuClientEvents[K]) => void,
  ): this;
  public override once(
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (...arguments_: any[]) => void,
  ): this {
    super.once(event as keyof BambuClientEvents, listener);

    return this;
  }

  public override on<K extends keyof BambuClientEvents>(
    event: K,
    listener: (...arguments_: BambuClientEvents[K]) => void,
  ): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public override on(event: string, listener: (...arguments_: any[]) => void): this {
    super.on(event as keyof BambuClientEvents, listener);

    return this;
  }

  public async connect() {
    return Promise.all([this.connectToMQTT(), this.connectToFTP()]);
  }

  public async disconnect(force = false, options?: Parameters<MqttClient['end']>[1]) {
    return new Promise((resolve) => this.mqttClient?.end(force, options, resolve));
  }

  public subscribe(topic: string): Promise<void> {
    this.logger.silly?.('Subscribing to printer', { topic });

    return new Promise<void>((resolve, reject) => {
      if (!this.mqttClient) {
        return reject('Client not connected.');
      }

      this.mqttClient.subscribe(topic, (error: Error | undefined) => {
        this.emit('subscribed', topic, error);

        if (error) {
          return reject(`Error subscribing to topic '${topic}': ${error.message}`);
        }

        this.logger.silly?.('Subscribed to printer', { topic });
      });

      const listener = (receivedTopic: string, payload: Buffer) => {
        if (receivedTopic !== topic) {
          return;
        }

        this.onMessage(payload.toString());
      };

      this.mqttClient.on('message', listener);

      resolve();
    });
  }

  public publish(message: string | object): Promise<void> {
    this.logger.silly?.('Publishing to printer', { message });

    return new Promise<void>((resolve, reject) => {
      if (!this.mqttClient) {
        return reject('Client not connected.');
      }

      const message_ = typeof message === 'string' ? message : JSON.stringify(message);

      const topic = `device/${this.config.serial}/request`;

      this.mqttClient.publish(topic, message_, (error) => {
        this.logger.silly?.('Published message: ', { topic, message: message_, error });
        this.emit('published', topic, message_, error);

        if (error) {
          return reject(`Error publishing to topic '${topic}': ${error.message}`);
        }

        this.logger.silly?.('Published to printer', { message });
        resolve();
      });
    });
  }

  public async executeCommand(command: CommandInterface): Promise<void> {
    return command.invoke(this);
  }

  protected async onConnect(packet: mqtt.IConnackPacket): Promise<void> {
    this.emit('connected', packet);

    this.logger.silly?.('Connected to printer');
    this.logger.debug('Subscribing to device report');
    await this.subscribe(`device/${this.config.serial}/report`);
    this.logger.debug('Getting version info');
    await this.executeCommand(new GetVersionCommand());
    this.logger.silly?.('Request Push All');
    await this.executeCommand(new PushAllCommand());
  }

  protected async onMessage(packet: string) {
    const data = JSON.parse(packet);
    const key = Object.keys(data)[0];

    this.emit('message', data[key]);
    this.logger.silly?.('onMessage: ', { key, data: JSON.stringify(data[key]) });

    if (isInfoMessage(data)) {
      this.emit(`command:${data.info.command}`, data.info as GetVersionCommandInterface);

      if (isGetVersionCommand(data.info)) {
        this._device = {
          modules: data.info.module.map((module) => ({
            hardwareVersion: module.hw_ver,
            name: module.name,
            serialNumber: module.sn,
            softwareVersion: module.sw_ver,
          })),
        };
      }
    }

    if (isPrintMessage(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.emit(`command:${data.print.command}`, data.print as any);

      if (isPushStatusCommand(data.print)) {
        await this.printerStatus.onStatus(data.print);
      }
    }

    if (isMCPrintMessage(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.emit(`command:${data.mc_print.command}`, data.mc_print as any);

      if (isPushInfoCommand(data.mc_print)) {
        this.emit('command:push_info:clean', getCleanPushInfoCommand(data.mc_print));
      }
    }
  }

  protected onDisconnect(packet: mqtt.IDisconnectPacket) {
    this.emit('disconnected', packet);
    this.logger.debug(`onDisconnect: Disconnected from printer: ${packet.reasonCode}`);
  }

  private async connectToMQTT() {
    return new Promise<void>((resolve, reject) => {
      this.mqttClient = mqtt.connect(`mqtts://${this.config.host}:${this.config.port ?? 8883}`, {
        username: 'bblp',
        password: this.config.token,
        reconnectPeriod: 1,
        rejectUnauthorized: false,
      });
      this.emit('connecting', this.mqttClient);

      this.mqttClient.once('connect', () => resolve());
      this.mqttClient.on('connect', this.onConnect.bind(this));
      this.mqttClient.on('disconnect', this.onDisconnect.bind(this));
      this.mqttClient.on('message', (topic, packet) => this.emit('rawMessage', topic, packet));

      this.mqttClient.on('error', (error) => {
        this.logger.error('Error connecting to Bambu MQTT server:', error.message);
        reject(error);
      });
    });
  }

  private async connectToFTP() {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    this.ftp.ftp.log = this.logger.silly?.bind(this.logger) ?? (() => {});

    this.ftp.trackProgress((info) => {
      this.logger.silly?.('FTP Progress: ', { ...info, label: 'Bambu:FTP' });
    });

    setInterval(() => {
      if (this.ftp.closed) {
        this.ftpService.connect();
      }
    }, 5000);

    return this.ftpService.connect();
  }
}
