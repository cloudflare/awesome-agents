/*
    We build on top of the traditional conversation context that looks like this:
    [
        { SYSTEM: .... },
        { USER: .... },
        { TOOL: .... },
        { ASSISTANT: .... },
        { USER: ....}
    ]
    
    and instead build our context solution like this:
    [
        {
            SYSTEM: 
            {{BASE INSTRUCTIONS}}
            {{MEMORY BLOCKS}}
        },
        { USER: .... },
        { ASSISTANT: .... },
        { USER: ....}
    ]
*/
