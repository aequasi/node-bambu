import type { CommandContext } from 'slash-create';
import { DataSource } from 'typeorm';
import { CommandOptionType, SlashCommandOptions, SlashCreator } from 'slash-create';
import { inject } from 'inversify';

import { BaseStatusCommand } from './BaseStatusCommand';
import { BambuRepository } from '../Repository/BambuRepository';
import { StatusService } from '../Service/StatusService';
import { SubscriptionService } from '../Service/SubscriptionService';
import { Subscription } from '../Entity/Subscription';

export class SubscribeCommand extends BaseStatusCommand {
  public constructor(
    @inject('database') database: DataSource,
    @inject('discord.slash-creator') creator: SlashCreator,
    @inject('repository.bambu') bambuRepository: BambuRepository,
    @inject('service.status') status: StatusService,
    @inject('service.subscription') private subscriptionService: SubscriptionService,
    @inject('discord.slash-creator-options') options: SlashCommandOptions,
  ) {
    super(database, creator, bambuRepository, status, {
      name: 'subscribe',
      description: 'Subscribes the current channel to posts from the bot when a print starts',
      options: [
        {
          name: 'printer',
          description: 'Printer to check',
          type: CommandOptionType.STRING,
          autocomplete: true,
        },
      ],
    });
  }

  public override async run(context: CommandContext) {
    if (!(await this.isPrinterOptionRequiredAndSet(context))) {
      return context.send('You must specify a printer with this command.');
    }

    const printer = this.getPrinterFromContext(context);

    if (!printer) {
      return context.send('Could not find that printer.');
    }

    await this.subscriptionService.addChannelSubscription(
      printer,
      new Subscription({
        channelId: context.channelID,
        createdBy: await this.getOwner(context),
        printer: printer.printer,
      }),
    );

    return context.send('Channel subscribed to updates', { ephemeral: true });
  }
}
