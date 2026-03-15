import { NextResponse } from 'next/server';
import { db } from '@/db';
import { waitlist } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      // Create new partial entry
      const [newEntry] = await db.insert(waitlist).values({
        ...updateData,
        status: 'partial',
      }).returning({ id: waitlist.id });
      
      return NextResponse.json({ id: newEntry.id });
    } else {
      // Update existing entry
      // If the incoming status is 'completed', we mark it as such.
      const statusToSet = updateData.status === 'completed' ? 'completed' : 'partial';
      
      await db.update(waitlist)
        .set({
          ...updateData,
          status: statusToSet,
          updatedAt: new Date()
        })
        .where(eq(waitlist.id, id));
        
      return NextResponse.json({ id, success: true });
    }
  } catch (error) {
    console.error('Error saving waitlist data:', error);
    return NextResponse.json({ error: 'Failed to save waitlist data' }, { status: 500 });
  }
}
