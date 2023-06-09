import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn, Unique } from 'typeorm';

import { Owner } from './Owner';
import { Queue, type Queue as QueueType } from './Queue';

@Entity()
@Unique('queue-item-queue-name', ['queue', 'name'])
export class QueueItem {
  @PrimaryGeneratedColumn('increment')
  public id: number;

  @Column('varchar')
  public name: string;

  @Column('text', { nullable: true })
  public description: string | undefined;

  @Column('text', { nullable: true })
  public link: string | undefined;

  @ManyToOne(() => Queue, (queue) => queue.items)
  public queue: QueueType;

  @Column('boolean', { default: false })
  public printed: boolean;

  @Column('timestamptz', { nullable: true })
  public printedAt: Date | undefined;

  @CreateDateColumn()
  public insertDate: Date;

  @UpdateDateColumn()
  public updateDate: Date;

  @ManyToOne(() => Owner, (owner) => owner.queues)
  public createdBy: Owner;

  public constructor(init?: Partial<QueueItem>) {
    Object.assign(this, init);
  }
}
