# Declutter

Close this tab in 60 seconds in inactivity: 
```
selfdestruct --inactive-secs 60
``` 

Add this list for automatic self destruction: 
```
selfdestruct auto this --inactive-secs 120 
``` 

Remove from list of selfdestructing pages:

```
selfdestruct auto not-this 
```

Its all stored in key `self-destruct-paths` as
```
{ 
    "<path>": <inactive seconds> 
}
````. 

Default time is 60 seconds. 
