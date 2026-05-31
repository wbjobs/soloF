import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

interface Preset {
  id: number;
  name: string;
  viscosity: number;
  diffusion: number;
  time_step: number;
  pressure_iterations: number;
  created_at: string;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const presets = db.prepare('SELECT * FROM presets ORDER BY created_at DESC').all() as Preset[];
    
    const formattedPresets = presets.map(preset => ({
      id: preset.id,
      name: preset.name,
      viscosity: preset.viscosity,
      diffusion: preset.diffusion,
      timeStep: preset.time_step,
      pressureIterations: preset.pressure_iterations,
      createdAt: preset.created_at,
    }));
    
    res.json(formattedPresets);
  } catch (error) {
    console.error('Error fetching presets:', error);
    res.status(500).json({ error: 'Failed to fetch presets' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, viscosity, diffusion, timeStep, pressureIterations } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const insert = db.prepare(`
      INSERT INTO presets (name, viscosity, diffusion, time_step, pressure_iterations)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = insert.run(name, viscosity, diffusion, timeStep, pressureIterations);
    
    const preset = db.prepare('SELECT * FROM presets WHERE id = ?').get(result.lastInsertRowid) as Preset;
    
    res.json({
      id: preset.id,
      name: preset.name,
      viscosity: preset.viscosity,
      diffusion: preset.diffusion,
      timeStep: preset.time_step,
      pressureIterations: preset.pressure_iterations,
      createdAt: preset.created_at,
    });
  } catch (error) {
    console.error('Error creating preset:', error);
    res.status(500).json({ error: 'Failed to create preset' });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting preset:', error);
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

export default router;
