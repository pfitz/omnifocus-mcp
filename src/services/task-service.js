import omniFocusBridge from '../utils/omnifocus-bridge.js';

/**
 * TaskService handles all task-related operations
 */
export class TaskService {
  constructor() {
    this.bridge = omniFocusBridge;
  }

  /**
   * Get tasks with optional filtering
   */
  async getTasks(args) {
    const script = `
      var tasks = doc.flattenedTasks();
      var result = [];
      
      for (var i = 0; i < tasks.length; i++) {
        var task = tasks[i];
        
        // Apply filters
        if (!${args.completed || false} && task.completed()) continue;
        if (${args.completed || false} && !task.completed()) continue;
        
        var taskInfo = ${this.bridge.getTaskFormatterScript('task')};
        
        // Apply additional filters
        var include = true;
        
        if (${JSON.stringify(args.project || null)} && taskInfo.project !== ${JSON.stringify(args.project || null)}) {
          include = false;
        }
        
        if (${args.flagged || false} && !taskInfo.flagged) {
          include = false;
        }
        
        if (${JSON.stringify(args.tag || null)} && !taskInfo.tags.includes(${JSON.stringify(args.tag || null)})) {
          include = false;
        }
        
        if (${args.due_today || false}) {
          if (!taskInfo.dueDate) {
            include = false;
          } else {
            var today = new Date();
            today.setHours(0,0,0,0);
            var tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            var dueDate = new Date(taskInfo.dueDate);
            if (dueDate < today || dueDate >= tomorrow) {
              include = false;
            }
          }
        }
        
        if (${args.due_soon || false}) {
          if (!taskInfo.dueDate) {
            include = false;
          } else {
            var weekFromNow = new Date();
            weekFromNow.setDate(weekFromNow.getDate() + 7);
            if (new Date(taskInfo.dueDate) > weekFromNow) {
              include = false;
            }
          }
        }
        
        if (include) {
          result.push(taskInfo);
        }
      }
      
      JSON.stringify(result);
    `;

    const result = await this.bridge.executeScript(script);
    const tasks = JSON.parse(result);
    
    return {
      content: [
        {
          type: 'text',
          text: `Found ${tasks.length} task${tasks.length !== 1 ? 's' : ''}:\n${JSON.stringify(tasks, null, 2)}`,
        },
      ],
    };
  }

  /**
   * Create a new task
   */
  async createTask(args) {
    const script = `
      var task;
      
      if (${JSON.stringify(args.project || null)}) {
        ${this.bridge.getFindProjectScript(args.project)}
        
        if (!project) {
          // Create the project if it doesn't exist
          project = app.Project({name: ${JSON.stringify(args.project)}});
          doc.projects.push(project);
        }
        
        task = app.Task({name: ${JSON.stringify(args.name)}});
        project.tasks.push(task);
      } else {
        // Add to inbox
        task = app.Task({name: ${JSON.stringify(args.name)}});
        doc.inboxTasks.push(task);
      }
      
      // Set task properties
      if (${JSON.stringify(args.note || null)}) {
        task.note = ${JSON.stringify(args.note)};
      }
      
      if (${args.flagged || false}) {
        task.flagged = true;
      }
      
      if (${args.estimated_minutes || null}) {
        task.estimatedMinutes = ${args.estimated_minutes};
      }
      
      if (${JSON.stringify(args.due_date || null)}) {
        task.dueDate = new Date(${JSON.stringify(args.due_date)});
      }
      
      if (${JSON.stringify(args.defer_date || null)}) {
        task.deferDate = new Date(${JSON.stringify(args.defer_date)});
      }
      
      // Add tags
      if (${JSON.stringify(args.tags || null)}) {
        var tagNames = ${JSON.stringify(args.tags || [])};
        for (var i = 0; i < tagNames.length; i++) {
          ${this.bridge.getFindOrCreateTagScript('tagNames[i]')}
          task.addTag(tag);
        }
      }
      
      JSON.stringify({
        id: task.id(),
        name: task.name(),
        message: "Task created successfully"
      });
    `;

    const result = await this.bridge.executeScript(script);
    const taskInfo = JSON.parse(result);
    
    return {
      content: [
        {
          type: 'text',
          text: taskInfo.message + `: "${taskInfo.name}"`,
        },
      ],
    };
  }

  /**
   * Create multiple tasks at once
   */
  async createTasksBatch(args) {
    const results = [];
    
    for (const taskData of args.tasks) {
      try {
        await this.createTask(taskData);
        results.push(`✓ Created: ${taskData.name}`);
      } catch (error) {
        results.push(`✗ Failed to create "${taskData.name}": ${error.message}`);
      }
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Batch task creation results:\n${results.join('\n')}`,
        },
      ],
    };
  }

  /**
   * Update an existing task
   */
  async updateTask(args) {
    const script = `
      ${this.bridge.getFindTaskScript(args.task_id)}
      
      if (!task) {
        JSON.stringify({error: "Task not found: " + ${JSON.stringify(args.task_id)}});
      } else {
        // Update task properties
        if (${JSON.stringify(args.name || null)}) {
          task.name = ${JSON.stringify(args.name)};
        }
        
        if (${JSON.stringify(args.note || null)}) {
          task.note = ${JSON.stringify(args.note)};
        }
        
        if (${args.flagged !== undefined}) {
          task.flagged = ${args.flagged};
        }
        
        if (${JSON.stringify(args.due_date || null)}) {
          task.dueDate = new Date(${JSON.stringify(args.due_date)});
        }
        
        if (${JSON.stringify(args.defer_date || null)}) {
          task.deferDate = new Date(${JSON.stringify(args.defer_date)});
        }
        
        JSON.stringify({
          id: task.id(),
          name: task.name(),
          message: "Task updated successfully"
        });
      }
    `;

    const result = await this.bridge.executeScript(script);
    const response = JSON.parse(result);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: response.message + `: "${response.name}"`,
        },
      ],
    };
  }

  /**
   * Complete a task
   */
  async completeTask(args) {
    const script = `
      ${this.bridge.getFindTaskScript(args.task_id)}
      
      if (!task) {
        JSON.stringify({error: "Task not found: " + ${JSON.stringify(args.task_id)}});
      } else {
        task.markComplete();
        JSON.stringify({
          name: task.name(),
          message: "Task completed"
        });
      }
    `;

    const result = await this.bridge.executeScript(script);
    const response = JSON.parse(result);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `${response.message}: "${response.name}"`,
        },
      ],
    };
  }

  /**
   * Delete a task
   */
  async deleteTask(args) {
    const script = `
      ${this.bridge.getFindTaskScript(args.task_id)}
      
      if (!task) {
        JSON.stringify({error: "Task not found: " + ${JSON.stringify(args.task_id)}});
      } else {
        var taskName = task.name();
        task.delete();
        JSON.stringify({
          name: taskName,
          message: "Task deleted"
        });
      }
    `;

    const result = await this.bridge.executeScript(script);
    const response = JSON.parse(result);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `${response.message}: "${response.name}"`,
        },
      ],
    };
  }

  /**
   * Search tasks with advanced query
   */
  async searchTasks(args) {
    const script = `
      var tasks = doc.flattenedTasks();
      var result = [];
      var query = ${JSON.stringify(args.query.toLowerCase())};
      
      for (var i = 0; i < tasks.length; i++) {
        var task = tasks[i];
        
        // Skip completed unless requested
        if (!${args.include_completed || false} && task.completed()) continue;
        
        // Search in name and note
        var name = task.name().toLowerCase();
        var note = (task.note() || "").toLowerCase();
        
        if (name.indexOf(query) === -1 && note.indexOf(query) === -1) continue;
        
        var taskInfo = ${this.bridge.getTaskFormatterScript('task')};
        
        // Apply date range filter
        if (${JSON.stringify(args.date_range || null)}) {
          var dateRange = ${JSON.stringify(args.date_range || {})};
          if (dateRange.start || dateRange.end) {
            var taskDate = task.dueDate() || task.deferDate();
            if (!taskDate) continue;
            
            if (dateRange.start && taskDate < new Date(dateRange.start)) continue;
            if (dateRange.end && taskDate > new Date(dateRange.end)) continue;
          }
        }
        
        // Apply project filter
        if (${JSON.stringify(args.projects || null)}) {
          var projects = ${JSON.stringify(args.projects || [])};
          if (projects.length > 0 && (!taskInfo.project || projects.indexOf(taskInfo.project) === -1)) {
            continue;
          }
        }
        
        // Apply tag filter
        if (${JSON.stringify(args.tags || null)}) {
          var requiredTags = ${JSON.stringify(args.tags || [])};
          var hasAllTags = true;
          for (var j = 0; j < requiredTags.length; j++) {
            if (taskInfo.tags.indexOf(requiredTags[j]) === -1) {
              hasAllTags = false;
              break;
            }
          }
          if (!hasAllTags) continue;
        }
        
        result.push(taskInfo);
      }
      
      JSON.stringify(result);
    `;

    const result = await this.bridge.executeScript(script);
    const tasks = JSON.parse(result);
    
    return {
      content: [
        {
          type: 'text',
          text: `Found ${tasks.length} task${tasks.length !== 1 ? 's' : ''} matching "${args.query}":\n${JSON.stringify(tasks, null, 2)}`,
        },
      ],
    };
  }

  /**
   * Create a recurring task
   */
  async createRecurringTask(args) {
    const script = `
      var task = app.Task({name: ${JSON.stringify(args.name)}});
      
      // Set basic properties
      if (${JSON.stringify(args.note || null)}) {
        task.note = ${JSON.stringify(args.note)};
      }
      
      // Set repeat rule
      var repeatRule = ${JSON.stringify(args.repeat_rule)};
      var repetitionRule = app.RepetitionRule();
      
      // Set frequency
      switch (repeatRule.frequency) {
        case 'daily':
          repetitionRule.unit = 'day';
          break;
        case 'weekly':
          repetitionRule.unit = 'week';
          break;
        case 'monthly':
          repetitionRule.unit = 'month';
          break;
        case 'yearly':
          repetitionRule.unit = 'year';
          break;
      }
      
      repetitionRule.steps = repeatRule.interval || 1;
      
      // Set repeat method
      if (repeatRule.repeat_from === 'completion_date') {
        repetitionRule.method = 'start after completion';
      } else {
        repetitionRule.method = 'due again';
      }
      
      task.repetitionRule = repetitionRule;
      
      // Set first due date
      if (${JSON.stringify(args.first_due_date || null)}) {
        task.dueDate = new Date(${JSON.stringify(args.first_due_date)});
      }
      
      // Add to project or inbox
      if (${JSON.stringify(args.project || null)}) {
        ${this.bridge.getFindProjectScript(args.project)}
        
        if (!project) {
          project = app.Project({name: ${JSON.stringify(args.project)}});
          doc.projects.push(project);
        }
        
        project.tasks.push(task);
      } else {
        doc.inboxTasks.push(task);
      }
      
      // Add tags
      if (${JSON.stringify(args.tags || null)}) {
        var tagNames = ${JSON.stringify(args.tags || [])};
        for (var j = 0; j < tagNames.length; j++) {
          ${this.bridge.getFindOrCreateTagScript('tagNames[j]')}
          task.addTag(tag);
        }
      }
      
      JSON.stringify({
        id: task.id(),
        name: task.name(),
        message: "Recurring task created successfully"
      });
    `;

    const result = await this.bridge.executeScript(script);
    const taskInfo = JSON.parse(result);
    
    return {
      content: [
        {
          type: 'text',
          text: `${taskInfo.message}: "${taskInfo.name}" (${args.repeat_rule.frequency})`,
        },
      ],
    };
  }

  /**
   * Defer multiple tasks
   */
  async deferTasks(args) {
    const script = `
      var results = [];
      var taskNames = ${JSON.stringify(args.tasks)};
      var newDeferDate = new Date(${JSON.stringify(args.defer_to)});
      
      for (var i = 0; i < taskNames.length; i++) {
        ${this.bridge.getFindTaskScript('taskNames[i]')}
        
        if (!task) {
          results.push("Task not found: " + taskNames[i]);
          continue;
        }
        
        var oldDeferDate = task.deferDate();
        task.deferDate = newDeferDate;
        
        // Adjust due date if requested
        if (${args.adjust_due_dates || false} && task.dueDate()) {
          var oldDueDate = task.dueDate();
          var deferDiff = newDeferDate - (oldDeferDate || new Date());
          var newDueDate = new Date(oldDueDate.getTime() + deferDiff);
          task.dueDate = newDueDate;
          results.push(task.name() + ": deferred to " + newDeferDate.toDateString() + 
                      ", due date adjusted to " + newDueDate.toDateString());
        } else {
          results.push(task.name() + ": deferred to " + newDeferDate.toDateString());
        }
      }
      
      JSON.stringify(results);
    `;

    const result = await this.bridge.executeScript(script);
    const results = JSON.parse(result);
    
    return {
      content: [
        {
          type: 'text',
          text: `Defer results:\n${results.join('\n')}`,
        },
      ],
    };
  }

  /**
   * Organize tasks by moving or tagging
   */
  async organizeTasks(args) {
    const script = `
      var results = [];
      var taskNames = ${JSON.stringify(args.tasks)};
      
      for (var i = 0; i < taskNames.length; i++) {
        ${this.bridge.getFindTaskScript('taskNames[i]')}
        
        if (!task) {
          results.push("Task not found: " + taskNames[i]);
          continue;
        }
        
        var actions = [];
        
        // Move to project
        if (${JSON.stringify(args.target_project || null)}) {
          ${this.bridge.getFindProjectScript(args.target_project)}
          
          if (project) {
            project.tasks.push(task);
            actions.push("moved to " + project.name());
          } else {
            actions.push("project not found: " + ${JSON.stringify(args.target_project)});
          }
        }
        
        // Add tags
        if (${JSON.stringify(args.add_tags || null)}) {
          var addTags = ${JSON.stringify(args.add_tags || [])};
          for (var l = 0; l < addTags.length; l++) {
            ${this.bridge.getFindOrCreateTagScript('addTags[l]')}
            task.addTag(tag);
            actions.push("added tag: " + addTags[l]);
          }
        }
        
        // Remove tags
        if (${JSON.stringify(args.remove_tags || null)}) {
          var removeTags = ${JSON.stringify(args.remove_tags || [])};
          var taskTags = task.tags();
          
          for (var n = 0; n < removeTags.length; n++) {
            var removeTagName = removeTags[n];
            
            for (var o = 0; o < taskTags.length; o++) {
              if (taskTags[o].name() === removeTagName) {
                task.removeTag(taskTags[o]);
                actions.push("removed tag: " + removeTagName);
                break;
              }
            }
          }
        }
        
        results.push(task.name() + ": " + (actions.length > 0 ? actions.join(", ") : "no changes"));
      }
      
      JSON.stringify(results);
    `;

    const result = await this.bridge.executeScript(script);
    const results = JSON.parse(result);
    
    return {
      content: [
        {
          type: 'text',
          text: `Organization results:\n${results.join('\n')}`,
        },
      ],
    };
  }
}

export default new TaskService();