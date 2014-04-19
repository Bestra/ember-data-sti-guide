ember-data-sti-guide
====================

The ins and outs of dealing with STI via ember data

##STI?

[Single Table Inheritance] (http://www.martinfowler.com/eaaCatalog/singleTableInheritance.html) can be very good for solving certain data modeling problems on the server.  If you've tried to translate your STI models over to Ember you'll also know that it's not something ember data does out of the box. 

Some quick notes on the tech stack we're using. 
* Rails and ActiveModelSerializers
* Ember Data and the ActiveModelAdapter/Serializer


Before we talk about _how_ to translate our STI models to Ember, here are the assumptions I'm going to make about our API server. I'm going to use Tasks as our example model.

1. Task is an ActiveRecord object and it has an arbitrary number of subclasses.

```ruby
  class Task < ActiveRecord::Base end
  class GroceryTask < Task end
```

2. All requests go to a `/tasks/` route (I'm only using a `TasksController` for everything task-related).
3. The API will serialize any Task subtypes with a root key of `task` and include a `type` property.
    
    ```javascript
    {
      task: {id: 5, type: 'GroceryTask'} //single task
      tasks: [{id: 5, type: 'GroceryTask'}] //array of tasks
    }
    ```

In Ember I'll make a type hierarchy similar to the one in Rails.
```javascript
App.Task = DS.Model.extend({type: DS.attr('string')});
App.GroceryTask = App.Task.extend();
```

* Ember should use the `/tasks/` endpoint for anything task-related.  `store.find('task', 5)` and `someTask.save()` should hit `/tasks/*` regardless of which subtype it is.  `/grocery_tasks/` is no good.
* When I ask the store for a Task by id, I could get back any subtype of Task (GroceryTask, DogWalkingTask, etc.)  If I have a GroceryTask with id=5 on the server, then `this.store.find('task', 5)` should return a GroceryTask.
* Sideloaded Tasks should get put into the store as the correct type.

##All subtypes of Task should use the same route on the api.
We can override the ActiveModelAdapter's [pathForType] (http://emberjs.com/api/data/classes/DS.ActiveModelAdapter.html#method_pathForType) function pretty easily. The adapter needs to use 'tasks' as its path to the api rather than 'grocery_tasks', etc.
```coffeescript
App.TaskAdapter = DS.ActiveModelAdapter.extend
  pathForType: (type) ->
    'tasks'
```

##When we find a task by id we should get the appropriate subtype.
Take a deep breath.  You're going to need to extend your [store's push function] (http://emberjs.com/api/data/classes/DS.Store.html#method_push).
###WAT
Let's say you try to find a task from the store.  `@store.find('task', 1)`.  
Internally this calls `store.findById()`, which in turn calls `@store.recordForId()` to initially look up the record. `recordForId` will _always_ return a record for the given type, __even if that record is empty__. If you look for a `Task` and get back a `GroceryTask` there's going to be an old `Task` sitting in the store that needs to be destroyed.
```
store.find() in a nutshell:
find -> findById -> recordForId (either finds the exiting record or puts an empty one into the store)
                 -> fetchRecord (if the record is empty)
                              -> (adapter makes ajax request) 
                              -> extractSingle
                              -> push
                              
function calls:  find('task', 5) -> findById -> recordForId -> fetchRecord -> Serializer.extractSingle -> push
Task record:                                      | Task:5                             |
GroceryTask record:                                                                    | GroceryTask:5

```
With STI, the type that we find isn't necessarily the type we're going to get back.  We could ask the store for a `Task` and we're going to get back a `GroceryTask`.  When the adapter returns its `GroceryTask` payload to push into the store, the `Task` that was created by the very first `recordForId` call is still in the store in an empty state, and we need to remove it. 

```coffeescript
push: (type, data, _partial) ->
    oldType = type
    dataType = data.type
    modelType = oldType
    if dataType && (@modelFor(oldType) != @modelFor(dataType))
      genericTypeRecord = @recordForId(oldType, data.id) #find the original record made by recordForId
      modelType = dataType
      @dematerializeRecord(genericTypeRecord)
    @_super @modelFor(modelType), data, _partial
```

##Sideloading tasks by type
The Serializer's `extractSingle` is used called during store.find('task', id) with the payload from the server.  There are two places we need to add functionality.  
Let's say we call `store.find('task', 5)` and we get back the following payload

```javascript
{
  task: {id: 5, type: 'GroceryTask', user_id: 1},
  users: [{id:1, name: 'Chris'}]
}
```

**Talk about overriding primaryTypeName**

```coffeescript
  # This is overridden because finding a 'task' and getting back a root key of 'author_task' will
  # break the isPrimary check.
  extractSingle: (store, primaryType, payload, recordId, requestType) ->
    payload = @normalizePayload(primaryType, payload)
    primaryTypeName = 'task' #=========>Overriden from primaryType.typeKey
    primaryRecord = undefined
    for prop of payload
      typeName = @typeForRoot(prop)
      type = store.modelFor(typeName)
      isPrimary = type.typeKey is primaryTypeName
      # legacy support for singular resources
      if isPrimary and Ember.typeOf(payload[prop]) isnt "array"
        primaryRecord = @normalize(primaryType, payload[prop], prop)
        continue

      #jshint loopfunc:true
      for hash in payload[prop]
        # hash.foobar = 'hello!'
        # ========>Custom check for STI type
        typeName = if hash.type
          hash.qualified_type = hash.type
          hash.type = hash.type.replace(/.+::/, '')
          @typeForRoot hash.type
        else
          @typeForRoot prop
        # <=======Custom check for STI type
```
##Associations

Sending data out
=================
###Serializing

All subtypes of task will have the same root key
```coffeescript
serializeIntoHash: (data, type, record, options) ->
      root = 'task'
      data[root] = this.serialize(record, options)
```
Bonus: Polymorphic Assocations
=================================
* Given a CalendarDay that hasMany tasks, CalendarDay.tasks() should return a collection of subtypes of Task.  This isn't directly related to STI, but it's still necessary for our client app.  

